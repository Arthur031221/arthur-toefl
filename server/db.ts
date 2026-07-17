import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const SEEDS_DIR = path.join(ROOT, 'seeds');

for (const dir of [DATA_DIR, RECORDINGS_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'toefl.sqlite');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_days (
  date TEXT PRIMARY KEY,
  dow TEXT NOT NULL,
  phase TEXT NOT NULL,
  type TEXT NOT NULL,
  videos TEXT NOT NULL DEFAULT '[]',
  main TEXT NOT NULL DEFAULT '',
  special TEXT NOT NULL DEFAULT '',
  missed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_checks (
  date TEXT NOT NULL,
  item TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 1,
  done_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (date, item)
);
CREATE TABLE IF NOT EXISTS carryover (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  content TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
  code TEXT PRIMARY KEY,
  course TEXT NOT NULL,
  title TEXT NOT NULL,
  dur TEXT NOT NULL DEFAULT '',
  speed TEXT NOT NULL DEFAULT '',
  done_target TEXT NOT NULL DEFAULT '',
  scheduled_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  tips TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS quota (
  item TEXT PRIMARY KEY,
  total INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  reserve INTEGER NOT NULL DEFAULT 0,
  rule TEXT NOT NULL DEFAULT '',
  planned TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS quota_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  delta INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS error_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL,
  wrong TEXT NOT NULL,
  correct TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '手動',
  repeat_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spelling_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  grp TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  correct_streak INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  retry_left INTEGER NOT NULL DEFAULT 0,
  retry_date TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (word, grp)
);
CREATE TABLE IF NOT EXISTS spelling_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS writing_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS writing_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  prompt_id INTEGER,
  prompt_text TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  seconds_used INTEGER NOT NULL DEFAULT 0,
  overtime INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  score REAL,
  score100 REAL,
  feedback TEXT NOT NULL DEFAULT '',
  used_flex INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interview_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS speaking_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  audio_path TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL DEFAULT 0,
  dead_air_count INTEGER NOT NULL DEFAULT 0,
  voiced_seconds REAL NOT NULL DEFAULT 0,
  silence_json TEXT NOT NULL DEFAULT '[]',
  transcript TEXT NOT NULL DEFAULT '',
  transcript_source TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  score100 REAL,
  is_baseline INTEGER NOT NULL DEFAULT 0,
  group_id TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repeat_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'audio',
  audio_path TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repeat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  reasons TEXT NOT NULL DEFAULT '{}',
  recording_path TEXT NOT NULL DEFAULT '',
  step INTEGER NOT NULL DEFAULT 1,
  done INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dictation_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'audio',
  audio_path TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL,
  source_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dictation_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  user_text TEXT NOT NULL DEFAULT '',
  accuracy REAL NOT NULL DEFAULT 0,
  missed TEXT NOT NULL DEFAULT '[]',
  reasons TEXT NOT NULL DEFAULT '{}',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mock_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  r REAL, l REAL, w REAL, s REAL,
  self_ws INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL UNIQUE,
  ctw_acc REAL,
  ann_acc REAL,
  selfcheck_catches INTEGER,
  deadair_avg REAL,
  next_week TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_templates (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  template TEXT NOT NULL,
  default_template TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  qtype TEXT NOT NULL,
  item_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  qtype TEXT NOT NULL,
  item_id TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '{}',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  whenuse TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
`);

/** 既有 DB 的欄位遷移(新欄位補上) */
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[migrate] ${table} 新增欄位 ${column} ✓`);
  }
}
ensureColumn('writing_sessions', 'score100', 'score100 REAL');
ensureColumn('speaking_sessions', 'score100', 'score100 REAL');
ensureColumn('repeat_materials', 'kind', "kind TEXT NOT NULL DEFAULT 'audio'");

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
