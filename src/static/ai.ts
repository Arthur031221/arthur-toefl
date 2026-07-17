/** 網頁版 AI:使用者自填 API key,瀏覽器直連 Anthropic Messages API */
import templates from '../../seeds/ai_templates.json';
import { settingsStore } from './store';

type TemplateKey = keyof typeof templates;

const JSON_SUFFIX = '\n\n請直接輸出單一 JSON 物件,不要 markdown code fence、不要任何其他文字。';

export function hasApiKey(): boolean {
  return settingsStore.get().apiKey.trim().length > 0;
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
  const { apiKey, model } = settingsStore.get();
  if (!apiKey.trim()) {
    throw new Error('尚未設定 API 金鑰。到「設定」貼上你的 Anthropic API key(只存在這台裝置的瀏覽器)。');
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
