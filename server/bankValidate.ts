/** 題庫項目格式驗證(種子載入與 AI 出題共用) */

export interface McqQuestion {
  q: string;
  options: string[];
  answer: number;
  qtype?: string;
  why?: string;
}

function isMcq(q: unknown, optCount = 4): q is McqQuestion {
  const x = q as McqQuestion;
  return (
    !!x &&
    typeof x.q === 'string' &&
    x.q.length > 0 &&
    Array.isArray(x.options) &&
    x.options.length === optCount &&
    x.options.every((o) => typeof o === 'string' && o.length > 0) &&
    typeof x.answer === 'number' &&
    x.answer >= 0 &&
    x.answer < optCount
  );
}

function wordCount(s: string): number {
  return (s.match(/[A-Za-z0-9'’-]+/g) || []).length;
}

/** CTW 挖空格式:{顯示:隱藏},恰好 10 格 */
export const CTW_BLANK_RE = /\{([A-Za-z'’-]{1,12}):([A-Za-z'’-]{1,12})\}/g;

export type Validator = (data: unknown) => string | null; // null = OK,否則錯誤訊息

export const validators: Record<string, Validator> = {
  ctw: (d) => {
    const x = d as { id?: string; title?: string; intro?: string; text?: string };
    if (!x?.id || !x.title || !x.intro || !x.text) return 'ctw 缺 id/title/intro/text';
    const blanks = [...x.text.matchAll(CTW_BLANK_RE)];
    if (blanks.length !== 10) return `ctw 挖空數必須是 10,目前 ${blanks.length}`;
    if (/\{[^:}]*\}|\{[^}]*:[^}]*:[^}]*\}/.test(x.text)) return 'ctw 有格式錯誤的挖空標記';
    return null;
  },
  daily_life: (d) => {
    const x = d as { id?: string; kind?: string; title?: string; body?: string; questions?: unknown[] };
    if (!x?.id || !x.kind || !x.title || !x.body) return 'daily_life 缺欄位';
    if (!Array.isArray(x.questions) || x.questions.length < 2 || x.questions.length > 3)
      return 'daily_life 題數需 2–3';
    if (!x.questions.every((q) => isMcq(q))) return 'daily_life 選擇題格式錯誤';
    const wc = wordCount(x.body);
    if (wc < 10 || wc > 170) return `daily_life 字數需 15–150,目前 ${wc}`;
    return null;
  },
  academic: (d) => {
    const x = d as { id?: string; title?: string; passage?: string; questions?: unknown[] };
    if (!x?.id || !x.title || !x.passage) return 'academic 缺欄位';
    const wc = wordCount(x.passage);
    if (wc < 150 || wc > 260) return `academic 篇幅需約 200 字(150–260),目前 ${wc}`;
    if (!Array.isArray(x.questions) || x.questions.length !== 5) return 'academic 需 5 題';
    if (!x.questions.every((q) => isMcq(q))) return 'academic 選擇題格式錯誤';
    return null;
  },
  lcr: (d) => {
    const x = d as { id?: string; stimulus?: string; options?: string[]; answer?: number };
    if (!x?.id || !x.stimulus) return 'lcr 缺欄位';
    if (!isMcq({ q: x.stimulus, options: x.options, answer: x.answer })) return 'lcr 選項格式錯誤';
    return null;
  },
  conversation: (d) => {
    const x = d as { id?: string; setting?: string; turns?: { spk?: string; text?: string }[]; questions?: unknown[] };
    if (!x?.id || !x.setting || !Array.isArray(x.turns) || x.turns.length < 4) return 'conversation 缺欄位或輪數 <4';
    if (!x.turns.every((t) => (t.spk === 'M' || t.spk === 'W') && typeof t.text === 'string' && t.text.length > 0))
      return 'conversation turns 格式錯誤(spk 需 M/W)';
    if (!Array.isArray(x.questions) || x.questions.length !== 2 || !x.questions.every((q) => isMcq(q)))
      return 'conversation 需恰好 2 題選擇題';
    return null;
  },
  announcement: (d) => {
    const x = d as { id?: string; setting?: string; text?: string; questions?: unknown[] };
    if (!x?.id || !x.setting || !x.text) return 'announcement 缺欄位';
    const wc = wordCount(x.text);
    if (wc < 35 || wc > 95) return `announcement 字數需 40–85,目前 ${wc}`;
    if (!Array.isArray(x.questions) || x.questions.length < 1 || x.questions.length > 2 || !x.questions.every((q) => isMcq(q)))
      return 'announcement 需 1–2 題選擇題';
    return null;
  },
  talk: (d) => {
    const x = d as { id?: string; topic?: string; text?: string; questions?: unknown[] };
    if (!x?.id || !x.topic || !x.text) return 'talk 缺欄位';
    const wc = wordCount(x.text);
    if (wc < 90 || wc > 270) return `talk 字數需 100–250,目前 ${wc}`;
    if (!Array.isArray(x.questions) || x.questions.length !== 4 || !x.questions.every((q) => isMcq(q)))
      return 'talk 需恰好 4 題選擇題';
    return null;
  },
  build_sentence: (d) => {
    const x = d as { id?: string; context?: string; answer?: string };
    if (!x?.id || !x.context || !x.answer) return 'build_sentence 缺 id/context/answer';
    const n = x.answer.split(/\s+/).filter(Boolean).length;
    if (n < 5 || n > 14) return `build_sentence 回應句需 5–14 個字,目前 ${n}`;
    if (/[.!?]$/.test(x.answer)) return 'build_sentence answer 不要含結尾標點(標點放 punct 欄)';
    return null;
  },
  lnr_set: (d) => {
    const x = d as { id?: string; title?: string; sentences?: string[] };
    if (!x?.id || !x.title || !Array.isArray(x.sentences)) return 'lnr_set 缺欄位';
    if (x.sentences.length !== 7) return `lnr_set 需恰好 7 句,目前 ${x.sentences?.length}`;
    const lens = x.sentences.map(wordCount);
    if (lens[0] > 9) return 'lnr_set 第 1 句應短(≤9 字)';
    if (lens[6] < 12) return 'lnr_set 第 7 句應長(≥12 字)';
    return null;
  },
};

/** 回傳每個 item 的錯誤(空陣列 = 全過) */
export function validateBank(qtype: string, items: unknown[]): string[] {
  const v = validators[qtype];
  if (!v) return [`未知題型 ${qtype}`];
  const errors: string[] = [];
  items.forEach((item, i) => {
    const err = v(item);
    if (err) errors.push(`[${qtype} #${i}] ${err}`);
  });
  return errors;
}
