/** 網頁版持久層:全部存 localStorage(單機、免伺服器) */

const PREFIX = 'toefl.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export interface StoredResult {
  qtype: string;
  item_id: string;
  correct: number;
  total: number;
  accuracy: number;
  seconds: number;
  detail?: unknown;
  date: string;
  ts: number;
}

export interface StoredError {
  id: number;
  cat: string;
  wrong: string;
  correct: string;
  note: string;
  source: string;
  repeat: number;
  date: string;
}

export interface StoredWord {
  word: string;
  grp: string;
  hint: string;
  streak: number;
  wrong: number;
  retryLeft: number;
  retryDate: string;
}

export interface StoredWriting {
  id: number;
  kind: string;
  prompt: string;
  answer: string;
  seconds: number;
  score: number | null;
  score100: number | null;
  feedback: unknown;
  date: string;
}

export interface StoredSpeaking {
  id: number;
  question: string;
  duration: number;
  deadAir: number;
  voiced: number;
  transcript: string;
  feedback: unknown;
  score100: number | null;
  date: string;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const results = {
  all: () => load<StoredResult[]>('results', []),
  add(r: Omit<StoredResult, 'date' | 'ts'>): StoredResult {
    const rows = results.all();
    const row = { ...r, date: todayStr(), ts: Date.now() };
    rows.push(row);
    save('results', rows);
    return row;
  },
};

export const errorsStore = {
  all: () => load<StoredError[]>('errors', []),
  saveAll: (rows: StoredError[]) => save('errors', rows),
  add(e: Omit<StoredError, 'id' | 'date' | 'repeat'>): void {
    const rows = errorsStore.all();
    const dup = rows.find((x) => x.wrong === e.wrong && x.correct === e.correct);
    if (dup) {
      dup.repeat += 1;
    } else {
      rows.push({ ...e, id: Date.now() + Math.floor(Math.random() * 1000), repeat: 0, date: todayStr() });
    }
    errorsStore.saveAll(rows);
  },
};

export const wordsStore = {
  all: () => load<StoredWord[]>('spelling', []),
  saveAll: (rows: StoredWord[]) => save('spelling', rows),
  addWord(word: string, hint = '(自動加入)'): void {
    const clean = word.trim();
    if (!/^[A-Za-z][A-Za-z'-]{1,30}$/.test(clean)) return;
    const rows = wordsStore.all();
    if (rows.some((w) => w.word.toLowerCase() === clean.toLowerCase() && w.grp === 'personal')) return;
    rows.push({ word: clean, grp: 'personal', hint, streak: 0, wrong: 0, retryLeft: 0, retryDate: '' });
    wordsStore.saveAll(rows);
  },
};

export const writingStore = {
  all: () => load<StoredWriting[]>('writing', []),
  saveAll: (rows: StoredWriting[]) => save('writing', rows),
};

export const speakingStore = {
  all: () => load<StoredSpeaking[]>('speaking', []),
  saveAll: (rows: StoredSpeaking[]) => save('speaking', rows),
};

export interface WebSettings {
  aiSource: 'server' | 'api'; // server=本機伺服器(Claude 訂閱,免費) api=直連(金鑰)
  serverUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULT_SETTINGS: WebSettings = {
  aiSource: 'server',
  serverUrl: 'http://localhost:3001',
  apiKey: '',
  model: 'claude-sonnet-4-6',
};

export const settingsStore = {
  get: (): WebSettings => ({ ...DEFAULT_SETTINGS, ...load<Partial<WebSettings>>('settings', {}) }),
  set: (s: WebSettings) => save('settings', s),
};

/** AI 出的題(擴充內建題庫) */
export const aiBankStore = {
  all: () => load<Record<string, { item_id: string; title: string; data: unknown }[]>>('aiBank', {}),
  add(qtype: string, itemId: string, title: string, data: unknown): void {
    const bank = aiBankStore.all();
    if (!bank[qtype]) bank[qtype] = [];
    bank[qtype].push({ item_id: itemId, title, data });
    save('aiBank', bank);
  },
};

/** 匯出/匯入(整份 localStorage) */
export function exportAll(): string {
  const dump: Record<string, unknown> = { app: 'toefl-web', version: 1, exportedAt: new Date().toISOString() };
  for (const key of ['results', 'errors', 'spelling', 'writing', 'speaking', 'aiBank', 'settings']) {
    dump[key] = load(key, null);
  }
  return JSON.stringify(dump, null, 1);
}

export function importAll(json: string): void {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (data.app !== 'toefl-web') throw new Error('格式不符:這不是網頁版匯出的備份');
  for (const key of ['results', 'errors', 'spelling', 'writing', 'speaking', 'aiBank', 'settings']) {
    if (data[key] !== null && data[key] !== undefined) save(key, data[key]);
  }
}
