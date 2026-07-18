/** 網頁版 AI:使用者自填 API key,瀏覽器直連 Anthropic Messages API */
import templates from '../../seeds/ai_templates.json';
import { settingsStore } from './store';

type TemplateKey = keyof typeof templates;

const JSON_SUFFIX = '\n\n請直接輸出單一 JSON 物件,不要 markdown code fence、不要任何其他文字。';

export function hasApiKey(): boolean {
  const s = settingsStore.get();
  return s.aiSource === 'server' || s.apiKey.trim().length > 0;
}

function fill(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** 與伺服器版相同的防彈 JSON 抽取 */
export function extractJson(text: string): unknown | null {
  if (!text) return null;
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(text);
  for (const src of candidates) {
    const start = src.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(src.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

export async function aiCall(kind: TemplateKey, vars: Record<string, string>): Promise<{ text: string; parsed: unknown | null }> {
  const { aiSource, serverUrl, apiKey, model } = settingsStore.get();

  // 路線 1:本機伺服器通道(走你的 Claude 訂閱,免費;需要家裡的 npm run dev 開著)
  if (aiSource === 'server') {
    let res: Response;
    try {
      res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/ai/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, vars }),
      });
    } catch {
      throw new Error(
        `連不到本機伺服器(${serverUrl})。請確認:①同一台電腦上 npm run dev 正在跑 ②或到「設定」切換成「直連 API」`
      );
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `本機伺服器錯誤(${res.status})`);
    }
    const data = (await res.json()) as { text: string; parsed: unknown | null };
    return { text: data.text, parsed: data.parsed ?? extractJson(data.text) };
  }

  // 路線 2:直連 Anthropic API(金鑰)
  if (!apiKey.trim()) {
    throw new Error('尚未設定 AI:到「設定」選「本機伺服器(訂閱)」並在電腦開 npm run dev,或改「直連 API」貼金鑰。');
  }
  const template = templates[kind]?.template;
  if (!template) throw new Error(`找不到模板 ${String(kind)}`);
  const prompt = fill(template, vars) + JSON_SUFFIX;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      // 官方支援的瀏覽器直連旗標(key 只在本機,風險自負)
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    let msg = `API 錯誤(${res.status})`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (res.status === 401) msg = 'API 金鑰無效,請檢查設定';
      else if (res.status === 429) msg = 'API 速率限制,稍等一分鐘再試';
      else if (err.error?.message) msg = err.error.message.slice(0, 200);
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
  return { text, parsed: extractJson(text) };
}
