import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOADS_DIR } from '../db.ts';
import { diffWords } from '../diff.ts';
import { addWordToSpelling } from './errors.ts';
import { nowIso, todayStr, addDays } from '../util.ts';

export const dictationRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.mp3';
      cb(null, `dict_${Date.now().toString(36)}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

/** 素材列表 */
dictationRouter.get('/dictation/materials', (_req, res) => {
  res.json(db.prepare('SELECT * FROM dictation_materials ORDER BY id DESC').all());
});

/** 建素材:上傳音檔+逐字稿,或純文字 TTS 素材 */
dictationRouter.post('/dictation/materials', upload.single('audio'), (req, res) => {
  const { title, transcript, source_note, kind } = req.body as Record<string, string | undefined>;
  if (!transcript?.trim()) return res.status(400).json({ error: '逐字稿必填' });
  const isTts = kind === 'tts' || !req.file;
  if (!isTts && !req.file) return res.status(400).json({ error: '請上傳音檔或改用 TTS 模式' });
  const r = db
    .prepare(
      'INSERT INTO dictation_materials (title, kind, audio_path, transcript, source_note, created_at) VALUES (?,?,?,?,?,?)'
    )
    .run(
      title?.trim() || '未命名素材',
      isTts ? 'tts' : 'audio',
      req.file ? `/uploads/${req.file.filename}` : '',
      transcript.trim(),
      source_note?.trim() ?? '',
      nowIso()
    );
  res.json(db.prepare('SELECT * FROM dictation_materials WHERE id = ?').get(r.lastInsertRowid));
});

dictationRouter.delete('/dictation/materials/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM dictation_materials WHERE id = ?').get(req.params.id) as
    | { audio_path: string }
    | undefined;
  if (m?.audio_path) {
    const fp = path.join(UPLOADS_DIR, path.basename(m.audio_path));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('DELETE FROM dictation_materials WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM dictation_attempts WHERE material_id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** 對答案(不落地,只回 diff) */
dictationRouter.post('/dictation/check', (req, res) => {
  const { material_id, user_text } = req.body as { material_id?: number; user_text?: string };
  const m = db.prepare('SELECT * FROM dictation_materials WHERE id = ?').get(material_id) as
    | { transcript: string }
    | undefined;
  if (!m) return res.status(404).json({ error: '找不到素材' });
  const { ops, accuracy } = diffWords(m.transcript, user_text ?? '');
  // 錯字候選(sub 且拼寫接近)
  const misspelled = ops
    .filter((o) => o.type === 'sub' && o.close && /^[A-Za-z]/.test(o.ref ?? ''))
    .map((o) => ({ wrong: o.hyp!, correct: o.ref! }));
  res.json({ ops, accuracy, misspelled });
});

/** 存一次聽寫結果(錯字自動流入拼寫詞庫) */
dictationRouter.post('/dictation/attempts', (req, res) => {
  const { material_id, user_text, reasons } = req.body as {
    material_id?: number;
    user_text?: string;
    reasons?: Record<string, number>;
  };
  const m = db.prepare('SELECT * FROM dictation_materials WHERE id = ?').get(material_id) as
    | { id: number; transcript: string }
    | undefined;
  if (!m) return res.status(404).json({ error: '找不到素材' });
  const { ops, accuracy } = diffWords(m.transcript, user_text ?? '');
  const missed = ops.filter((o) => o.type !== 'equal');
  const misspelled = ops
    .filter((o) => o.type === 'sub' && o.close && /^[A-Za-z]{3,}/.test(o.ref ?? ''))
    .map((o) => o.ref!) as string[];
  for (const w of misspelled) addWordToSpelling(w);

  db.prepare(
    'INSERT INTO dictation_attempts (material_id, user_text, accuracy, missed, reasons, date, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(
    m.id,
    user_text ?? '',
    accuracy,
    JSON.stringify(missed),
    JSON.stringify(reasons ?? {}),
    todayStr(),
    nowIso()
  );
  res.json({ ok: true, accuracy, wordsAddedToSpelling: misspelled });
});

/** 每日正確率趨勢 + 漏聽原因統計 */
dictationRouter.get('/dictation/stats', (_req, res) => {
  const today = todayStr();
  const from = addDays(today, -30);
  const daily = db
    .prepare(
      'SELECT date, AVG(accuracy) AS acc, COUNT(*) AS n FROM dictation_attempts WHERE date >= ? GROUP BY date ORDER BY date'
    )
    .all(from) as { date: string; acc: number; n: number }[];
  const rows = db.prepare('SELECT reasons FROM dictation_attempts').all() as { reasons: string }[];
  const reasonTotals: Record<string, number> = {};
  for (const r of rows) {
    try {
      const obj = JSON.parse(r.reasons) as Record<string, number>;
      for (const [k, v] of Object.entries(obj)) reasonTotals[k] = (reasonTotals[k] ?? 0) + v;
    } catch {
      /* skip */
    }
  }
  res.json({
    daily: daily.map((d) => ({ ...d, acc: Math.round(d.acc * 10) / 10, date: d.date.slice(5) })),
    reasonTotals,
  });
});

/** 某素材的歷史 */
dictationRouter.get('/dictation/materials/:id/attempts', (req, res) => {
  res.json(
    db
      .prepare('SELECT id, accuracy, date, created_at FROM dictation_attempts WHERE material_id = ? ORDER BY id DESC LIMIT 20')
      .all(req.params.id)
  );
});
