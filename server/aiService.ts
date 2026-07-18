import { execFile } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { db, getSetting } from './db.ts';
import { extractJson } from './util.ts';
import { getSystemStatus } from './system.ts';

export type FeedbackKind =
  | 'grade_email'
  | 'grade_discussion'
  | 'speaking_feedback'
  | 'gen_email'
  | 'gen_discussion'
  | 'gen_repeat'
  | 'gen_ctw'
  | 'gen_daily_life'
  | 'gen_academic'
  | 'gen_lcr'
  | 'gen_conversation'
  | 'gen_announcement'
  | 'gen_talk'
  | 'gen_build_sentence';

export interface FeedbackResult {
  text: string;
  parsed: unknown | null;
  provider: 'cli' | 'api';
  ms: number;
}

// 批改實測 25-50 秒;系統忙(多個 Claude 程序並行)時會更久,放寬到 150 秒
const TIMEOUT_MS = 150_000;
const JSON_SUFFIX = '\n\n請直接輸出單一 JSON 物件,不要 markdown code fence、不要任何其他文字。';

/** 併發上鎖:同時只跑一個 AI 請求,其餘排隊 */
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function getTemplate(kind: FeedbackKind): string {
  const row = db.prepare('SELECT template FROM ai_templates WHERE key = ?').get(kind) as
    | { template: string }
    | undefined;
  if (!row) throw new Error(`找不到 prompt 模板:${kind}`);
  return row.template;
}

/** 只替換已知 placeholder,不動模板中其它大括號(JSON 範例) */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/** Provider A:本機 Claude Code CLI(headless) */
function callCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // 移除 API key,確保走使用者的 Claude 訂閱而非計費 API
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const child = execFile(
      'claude',
      ['-p', prompt, '--output-format', 'json'],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (e.code === 'ENOENT') {
            return reject(
              new Error('找不到 claude 指令。請確認已安裝並登入 Claude Code CLI,或到「設定」切換為 Anthropic API。')
            );
          }
          if (e.killed) {
            return reject(
              new Error(
                `Claude CLI 逾時(${TIMEOUT_MS / 1000} 秒)。通常是系統暫時壅塞,你的作答已保存,再按一次批改即可;若連續失敗,檢查 claude 訂閱用量是否達上限。`
              )
            );
          }
          return reject(new Error(`Claude CLI 執行失敗:${(stderr || e.message || '').slice(0, 300)}`));
        }
        try {
          const wrapper = JSON.parse(stdout) as { result?: string; is_error?: boolean };
          if (wrapper.is_error) {
            return reject(new Error(`Claude CLI 回報錯誤:${String(wrapper.result).slice(0, 300)}`));
          }
          resolve(typeof wrapper.result === 'string' ? wrapper.result : stdout);
        } catch {
          resolve(stdout); // wrapper 解析失敗就用原始輸出
        }
      }
    );
    child.on('error', () => {
      /* execFile callback 已處理 */
    });
  });
}

/** Provider B:Anthropic API(官方 SDK) */
async function callApi(prompt: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('未設定 ANTHROPIC_API_KEY。請在 app/.env 填入金鑰(參考 .env.example),或到「設定」切換為 Claude CLI。');
  }
  const client = new Anthropic();
  const model = getSetting('anthropic_model', 'claude-sonnet-4-6');
  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: TIMEOUT_MS }
    );
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (!text) throw new Error('API 回傳空白內容');
    return text;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      throw new Error('API 金鑰無效,請檢查 .env 的 ANTHROPIC_API_KEY。');
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw new Error(`模型 ${model} 不存在,請到「設定」修改模型名稱。`);
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new Error('API 速率限制,請稍等一分鐘再試。');
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new Error('無法連線到 Anthropic API,請檢查網路。');
    }
    throw e;
  }
}

export function currentProvider(): 'cli' | 'api' {
  return getSetting('ai_provider', 'cli') === 'api' ? 'api' : 'cli';
}

/** 統一入口:組模板 → 呼叫 provider → 抽 JSON */
export async function getFeedback(
  kind: FeedbackKind,
  vars: Record<string, string>,
  options?: { provider?: 'cli' | 'api' }
): Promise<FeedbackResult> {
  const template = getTemplate(kind);
  const prompt = fillTemplate(template, vars) + JSON_SUFFIX;
  return rawPrompt(prompt, options);
}

/** 直接送 prompt(測試連線等用途) */
export async function rawPrompt(
  prompt: string,
  options?: { provider?: 'cli' | 'api' }
): Promise<FeedbackResult> {
  const provider = options?.provider ?? currentProvider();
  const start = Date.now();
  const text = await withLock(() => (provider === 'cli' ? callCli(prompt) : callApi(prompt)));
  return { text, parsed: extractJson(text), provider, ms: Date.now() - start };
}

/** 連線測試 */
export async function testProvider(provider: 'cli' | 'api'): Promise<FeedbackResult> {
  if (provider === 'cli' && !getSystemStatus(true).claudeCli) {
    throw new Error('系統找不到 claude 指令。請先安裝 Claude Code CLI 並登入,或改用 Anthropic API。');
  }
  return rawPrompt('請只回覆兩個字:OK', { provider });
}
