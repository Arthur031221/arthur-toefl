import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, RECORDINGS_DIR } from '../db.ts';
import { analyzeAudio, shiftAnalysis } from '../audio.ts';
import { whisperTranscribe } from '../transcribe.ts';
import { getFeedback } from '../aiService.ts';
import { nowIso, todayStr, addDays } from '../util.ts';

export const speakingRouter = Router();

const ALLOWED_EXT = new Set(['.webm', '.m4a', '.mp3', '.wav', '.ogg', '.mp4', '.aac']);

const storage = multer.diskStorage({
  destination: RECORDINGS_DIR,
  filename: (req, file, cb) => {
    const mode = String(req.body.mode || 'interview').replace(/[^a-z_]/gi, '') || 'interview';
    const qid = String(req.body.question_id || '0').replace(/\D/g, '') || '0';
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) ext = '.webm';
    const stamp = todayStr().replace(/-/g, '');
    const unique = Date.now().toString(36);
    cb(null, `${stamp}_${mode}_${qid}_${unique}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext && !ALLOWED_EXT.has(ext)) return cb(new Error('只接受 webm/m4a/mp3/wav/ogg 音檔'));
    cb(null, true);
  },
});

/** 題庫 */
speakingRouter.get('/speaking/questions', (_req, res) => {
  res.json(db.prepare('SELECT * FROM interview_questions ORDER BY id').all());
});

speakingRouter.post('/speaking/questions', (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ error: '題目不可為空' });
  const r = db
    .prepare("INSERT INTO interview_questions (text, source, created_at) VALUES (?,'custom',?)")
    .run(text.trim(), nowIso());
  res.json(db.prepare('SELECT * FROM interview_questions WHERE id = ?').get(r.lastInsertRowid));
});

/** 錄音上傳 → ffmpeg 三指標 → 建立練習紀錄 */
speakingRouter.post('/speaking/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '沒有收到音檔' });
  const { mode, question, group_id, is_baseline, lead } = req.body as Record<string, string | undefined>;
  const filePath = req.file.path;
  const relPath = `/recordings/${req.file.filename}`;
  const leadSec = Math.max(0, Number(lead) || 0); // 錄音器偷跑秒數,指標計算時扣除

  let analysis = { duration: 0, deadAirCount: 0, voicedSeconds: 0, silences: [] as unknown[] };
  let analysisError = '';
  try {
    analysis = shiftAnalysis(await analyzeAudio(filePath), leadSec);
  } catch (e) {
    analysisError = (e as Error).message; // 分析失敗仍保留錄音
  }

  const r = db
    .prepare(
      `INSERT INTO speaking_sessions
       (mode, question, audio_path, duration, dead_air_count, voiced_seconds, silence_json, is_baseline, group_id, date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      mode || 'interview',
      question || '',
      relPath,
      analysis.duration,
      analysis.deadAirCount,
      analysis.voicedSeconds,
      JSON.stringify(analysis.silences),
      is_baseline === '1' || is_baseline === 'true' ? 1 : 0,
      group_id || '',
      todayStr(),
      nowIso()
    );
  const session = db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(r.lastInsertRowid);
  res.json({ session, analysisError: analysisError || undefined });
});

/** 重跑指標分析 */
speakingRouter.post('/speaking/sessions/:id/analyze', async (req, res) => {
  const s = getSession(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '找不到錄音紀錄' });
  const filePath = path.join(RECORDINGS_DIR, path.basename(s.audio_path));
  try {
    const a = await analyzeAudio(filePath);
    db.prepare(
      'UPDATE speaking_sessions SET duration = ?, dead_air_count = ?, voiced_seconds = ?, silence_json = ? WHERE id = ?'
    ).run(a.duration, a.deadAirCount, a.voicedSeconds, JSON.stringify(a.silences), s.id);
    res.json(db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(s.id));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** faster-whisper 本地轉錄 */
speakingRouter.post('/speaking/sessions/:id/transcribe', async (req, res) => {
  const s = getSession(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '找不到錄音紀錄' });
  const filePath = path.join(RECORDINGS_DIR, path.basename(s.audio_path));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '音檔遺失' });
  try {
    const t = await whisperTranscribe(filePath);
    db.prepare("UPDATE speaking_sessions SET transcript = ?, transcript_source = 'whisper' WHERE id = ?").run(
      t.text,
      s.id
    );
    res.json({ ok: true, transcript: t.text, segments: t.segments });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** 手動/瀏覽器轉錄結果寫入 */
speakingRouter.patch('/speaking/sessions/:id', (req, res) => {
  const s = getSession(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '找不到錄音紀錄' });
  const { transcript, transcript_source, question } = req.body as Record<string, string | undefined>;
  db.prepare(
    'UPDATE speaking_sessions SET transcript = ?, transcript_source = ?, question = ? WHERE id = ?'
  ).run(
    transcript ?? s.transcript,
    transcript_source ?? s.transcript_source,
    question ?? s.question,
    s.id
  );
  res.json(db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(s.id));
});

/** AI 口說回饋 */
speakingRouter.post('/speaking/sessions/:id/feedback', async (req, res) => {
  const s = getSession(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '找不到錄音紀錄' });
  if (!s.transcript.trim()) return res.status(400).json({ error: '請先取得逐字稿(轉錄或手動貼上)' });
  try {
    const r = await getFeedback('speaking_feedback', {
      question: s.question || '(未記錄題目)',
      transcript: s.transcript,
    });
    const parsed = (r.parsed ?? {}) as { score100?: number };
    db.prepare('UPDATE speaking_sessions SET feedback = ?, score100 = ? WHERE id = ?').run(
      JSON.stringify(r.parsed ?? { raw: r.text }),
      typeof parsed.score100 === 'number' ? parsed.score100 : null,
      s.id
    );
    res.json({ ok: true, parsed: r.parsed, raw: r.text, provider: r.provider, ms: r.ms });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** 單筆 */
speakingRouter.get('/speaking/sessions/:id(\\d+)', (req, res) => {
  const s = db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到錄音紀錄' });
  res.json(s);
});

/** 歷史列表 */
speakingRouter.get('/speaking/sessions', (req, res) => {
  const mode = req.query.mode as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows =
    mode && mode !== 'all'
      ? db.prepare('SELECT * FROM speaking_sessions WHERE mode = ? ORDER BY id DESC LIMIT ?').all(mode, limit)
      : db.prepare('SELECT * FROM speaking_sessions ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
});

/** 指標趨勢(死寂次數與發聲秒數隨日期) */
speakingRouter.get('/speaking/trend', (_req, res) => {
  const today = todayStr();
  const from = addDays(today, -30);
  const rows = db
    .prepare(
      `SELECT date, AVG(dead_air_count) AS dead_air, AVG(voiced_seconds) AS voiced, COUNT(*) AS n
       FROM speaking_sessions
       WHERE mode = 'interview' AND date >= ?
       GROUP BY date ORDER BY date`
    )
    .all(from);
  res.json(rows);
});

speakingRouter.delete('/speaking/sessions/:id', (req, res) => {
  const s = getSession(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '找不到錄音紀錄' });
  const filePath = path.join(RECORDINGS_DIR, path.basename(s.audio_path));
  db.prepare('DELETE FROM speaking_sessions WHERE id = ?').run(s.id);
  if (s.audio_path && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

interface SessionRow {
  id: number;
  mode: string;
  question: string;
  audio_path: string;
  transcript: string;
  transcript_source: string;
  is_baseline: number;
}

function getSession(id: number): SessionRow | undefined {
  return db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(id) as SessionRow | undefined;
}
