/** 題庫項目型別(與 seeds/bank_*.json 對齊) */

export interface McqQ {
  q: string;
  options: string[];
  answer: number;
  qtype?: string;
  why?: string;
}

export interface CtwItem {
  id: string;
  title: string;
  topic: string;
  intro: string;
  text: string; // 內含 {顯示:隱藏} 挖空標記 ×10
}

export interface DailyLifeItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  questions: McqQ[];
}

export interface AcademicItem {
  id: string;
  title: string;
  topic: string;
  passage: string;
  questions: McqQ[];
}

export interface LcrItem {
  id: string;
  stimulus: string;
  tone_note?: string;
  options: string[];
  answer: number;
  why?: string;
}

export interface ConversationItem {
  id: string;
  setting: string;
  turns: { spk: 'M' | 'W'; text: string }[];
  questions: McqQ[];
}

export interface AnnouncementItem {
  id: string;
  setting: string;
  text: string;
  questions: McqQ[];
}

export interface TalkItem {
  id: string;
  topic: string;
  text: string;
  questions: McqQ[];
}

export interface BuildSentenceItem {
  id: string;
  context: string;
  answer: string;
  punct?: string;
  hint_zh?: string;
}

export interface LnrSetItem {
  id: string;
  title: string;
  sentences: string[];
}

export type BankItemData =
  | CtwItem
  | DailyLifeItem
  | AcademicItem
  | LcrItem
  | ConversationItem
  | AnnouncementItem
  | TalkItem
  | BuildSentenceItem
  | LnrSetItem;

export interface BankListRow {
  qtype: string;
  item_id: string;
  title: string;
  source: string;
  attempts: number;
  best: number | null;
}

export interface DiffOp {
  type: 'equal' | 'sub' | 'del' | 'ins';
  ref?: string;
  hyp?: string;
  close?: boolean;
}

export interface ShadowScore {
  transcript: string;
  accuracy: number;
  unclear: { word: string; heard: string }[];
  ops: DiffOp[];
}

export interface PracticeResultInput {
  qtype: string;
  item_id: string;
  correct: number;
  total: number;
  seconds: number;
  detail?: unknown;
}

export interface PracticeStats {
  totals: { qtype: string; attempts: number; avg: number; questions: number }[];
  daily: { date: string; qtype: string; acc: number; n: number }[];
  bankCounts: { qtype: string; n: number }[];
}

/** 資料來源抽象:localhost 走伺服器 API,網頁版走 localStorage */
export interface PracticeProvider {
  readonly mode: 'server' | 'static';
  listItems(qtype: string): Promise<BankListRow[]>;
  getItem(itemId: string): Promise<{ qtype: string; data: BankItemData }>;
  /** AI 出題;不可用時 throw 帶中文訊息 */
  generate(qtype: string): Promise<{ item_id: string }>;
  submitResult(r: PracticeResultInput): Promise<{ accuracy: number; wordsAddedToSpelling?: string[] }>;
  stats(): Promise<PracticeStats>;
  /** 跟讀評分:錄音 → 逐字稿 → 與目標句比對 */
  scoreShadow(blob: Blob, target: string, webSpeechText: string): Promise<ShadowScore>;
}

export const QTYPE_LABEL: Record<string, string> = {
  ctw: '完形填空 CTW',
  daily_life: '日常生活閱讀',
  academic: '學術閱讀',
  lcr: '句子應答 LCR',
  conversation: '二人對話',
  announcement: '公告',
  talk: '學術短講',
  build_sentence: '組織句子',
  lnr_set: 'Listen & Repeat',
};

export const CTW_BLANK_RE = /\{([A-Za-z'’-]{1,12}):([A-Za-z'’-]{1,12})\}/g;

/** 把 ctw text 拆成 段落片段 與 挖空 */
export function parseCtw(text: string): ({ t: 'text'; s: string } | { t: 'blank'; show: string; ans: string })[] {
  const parts: ({ t: 'text'; s: string } | { t: 'blank'; show: string; ans: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(CTW_BLANK_RE)) {
    if (m.index! > last) parts.push({ t: 'text', s: text.slice(last, m.index) });
    parts.push({ t: 'blank', show: m[1], ans: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ t: 'text', s: text.slice(last) });
  return parts;
}
