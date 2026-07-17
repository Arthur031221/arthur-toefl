import { Router } from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, DB_PATH, RECORDINGS_DIR } from '../db.ts';

export const settingsRouter = Router();

/** 匯出/匯入涵蓋的資料表 */
const TABLES = [
  'meta', 'plan_days', 'daily_checks', 'carryover', 'videos', 'quota', 'quota_log',
  'error_book', 'spelling_words', 'spelling_attempts', 'writing_prompts', 'writing_sessions',
  'interview_questions', 'speaking_sessions', 'repeat_materials', 'repeat_sessions',
  'dictation_materials', 'dictation_attempts', 'mock_exams', 'weekly_reviews',
  'ai_templates', 'settings', 'links', 'methods',
] as const;

settingsRouter.get('/settings', (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  res.json({
    settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    paths: { data: DATA_DIR, recordings: RECORDINGS_DIR, db: DB_PATH },
  });
});

/** 匯出全部資料為 JSON */
settingsRouter.get('/export', (_req, res) => {
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  res.setHeader('Content-Disposition', `attachment; filename="toefl-backup-${Date.now()}.json"`);
  res.json({
    app: 'toefl-platform',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: '錄音檔不在此備份內,請另外複製 data/recordings 資料夾',
    tables: dump,
  });
});

/** 匯入(整份還原;匯入前自動備份現有 DB 檔) */
settingsRouter.post('/import', (req, res) => {
  const payload = req.body as { app?: string; tables?: Record<string, unknown[]> };
  if (payload?.app !== 'toefl-platform' || !payload.tables) {
    return res.status(400).json({ error: '格式不符:這不是本平台匯出的備份 JSON' });
  }
  // 匯入前備份
  const backupPath = path.join(DATA_DIR, `pre-import-backup-${Date.now()}.sqlite`);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(DB_PATH, backupPath);

  const counts: Record<string, number> = {};
  const tx = db.transaction(() => {
    for (const t of TABLES) {
      const rows = payload.tables![t];
      if (!Array.isArray(rows)) continue;
      db.prepare(`DELETE FROM ${t}`).run();
      if (rows.length === 0) {
        counts[t] = 0;
        continue;
      }
      const cols = Object.keys(rows[0] as Record<string, unknown>);
      const ins = db.prepare(
        `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
      );
      for (const row of rows) {
        ins.run(...cols.map((c) => (row as Record<string, unknown>)[c] ?? null));
      }
      counts[t] = rows.length;
    }
  });
  try {
    tx();
  } catch (e) {
    return res.status(500).json({
      error: `匯入失敗:${(e as Error).message}。原資料未變動,備份在 ${backupPath}`,
    });
  }
  res.json({ ok: true, counts, backupPath });
});

/** 開啟資料夾(Linux xdg-open / WSL explorer.exe,盡力而為) */
settingsRouter.post('/settings/open-folder', (req, res) => {
  const { which } = req.body as { which?: string };
  const target = which === 'recordings' ? RECORDINGS_DIR : DATA_DIR;
  const isWsl = fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  const cmd = isWsl ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const arg = isWsl ? target.replace(/\//g, '\\\\') : target;
  execFile(cmd, [isWsl ? `\\\\wsl$\\${arg}` : arg], () => {
    /* 開不了就算了,前端顯示路徑 */
  });
  res.json({ ok: true, path: target });
});
