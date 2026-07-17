export const EXAM_DATE = '2026-09-19';

/** 本地日期 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 兩個 YYYY-MM-DD 的日數差(b - a) */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(
    t.getUTCDate()
  ).padStart(2, '0')}`;
}

/** 該日期所屬週的週一(週為一~日) */
export function weekStartOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(date, offset);
}

export function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 從 AI 回覆文字中穩健抽出第一個完整 JSON 物件 */
export function extractJson(text: string): unknown | null {
  if (!text) return null;
  // 去掉 markdown code fence
  const cleaned = text.replace(/```(?:json)?/gi, '```');
  const candidates: string[] = [];
  const fenceMatch = cleaned.match(/```([\s\S]*?)```/);
  if (fenceMatch) candidates.push(fenceMatch[1]);
  candidates.push(text);
  for (const src of candidates) {
    const start = src.indexOf('{');
    if (start === -1) continue;
    // 括號配對掃描(忽略字串內的括號)
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
          const chunk = src.slice(start, i + 1);
          try {
            return JSON.parse(chunk);
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/** 英文字數統計 */
export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9'’-]+/g) || []).length;
}
