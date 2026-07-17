import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOADS_DIR, RECORDINGS_DIR } from '../db.ts';
import { nowIso, todayStr } from '../util.ts';
import { getFeedback } from '../aiService.ts';
import { diffWords } from '../diff.ts';

export const repeatRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.mp3';
      cb(null, `repeat_${Date.now().toString(36)}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const recUpload = multer({
  storage: multer.diskStorage({
    destination: RECORDINGS_DIR,
    filename: (_req, _file, cb) => {
      cb(null, `${todayStr().replace(/-/g, '')}_repeat_${Date.now().toString(36)}.webm`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

/** 跟讀素材 */
repeatRouter.get('/repeat/materials', (_req, res) => {
  res.json(db.prepare('SELECT * FROM repeat_materials ORDER BY id DESC').all());
});

repeatRouter.post('/repeat/materials', upload.single('audio'), (req, res) => {
  const { title, transcript, youtube_url } = req.body as Record<string, string | undefined>;
  if (!transcript?.trim()) return res.status(400).json({ error: '逐字稿必填(四步法的字幕)' });
  // 沒音檔也沒連結 → 當 TTS 素材(瀏覽器逐句朗讀)
  const kind = req.file || youtube_url?.trim() ? 'audio' : 'tts';
  const r = db
    .prepare(
      'INSERT INTO repeat_materials (title, kind, audio_path, youtube_url, transcript, created_at) VALUES (?,?,?,?,?,?)'
    )
    .run(
      title?.trim() || '未命名素材',
      kind,
      req.file ? `/uploads/${req.file.filename}` : '',
      youtube_url?.trim() ?? '',
      transcript.trim(),
      nowIso()
    );
  res.json(db.prepare('SELECT * FROM repeat_materials WHERE id = ?').get(r.lastInsertRowid));
});

/** AI 生成跟讀題庫(TTS 播放,不耗 Flex) */
repeatRouter.post('/repeat/generate', async (req, res) => {
  const { topic, count } = req.body as { topic?: string; count?: number };
  try {
    const r = await getFeedback('gen_repeat', {
      count: String(Math.min(Math.max(Number(count) || 8, 4), 12)),
      topic: topic?.trim() || '校園生活、課堂學術、日常對話混合',
    });
    const parsed = r.parsed as { title?: string; sentences?: string[] } | null;
    const sentences = (parsed?.sentences ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (sentences.length === 0) {
      return res.status(502).json({ error: 'AI 回傳格式不符,請重試', raw: r.text.slice(0, 300) });
    }
    const ins = db
      .prepare(
        "INSERT INTO repeat_materials (title, kind, audio_path, youtube_url, transcript, created_at) VALUES (?,'tts','','',?,?)"
      )
      .run(`AI|${parsed?.title || '跟讀句庫'}`, sentences.join('\n'), nowIso());
    res.json(db.prepare('SELECT * FROM repeat_materials WHERE id = ?').get(ins.lastInsertRowid));
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** 跟讀清晰度評分:比對目標句 vs 你的逐字稿,標出講不清楚的字 */
repeatRouter.post('/repeat/shadow-score', (req, res) => {
  const { session_id } = req.body as { session_id?: number };
  const s = db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(session_id) as
    | { id: number; question: string; transcript: string }
    | undefined;
  if (!s) return res.status(404).json({ error: '找不到錄音紀錄' });
  if (!s.question.trim()) return res.status(400).json({ error: '此錄音沒有目標句' });
  if (!s.transcript.trim()) {
    return res.status(400).json({ error: '還沒有你的逐字稿(先轉錄或開即時轉錄)' });
  }
  const { ops, accuracy } = diffWords(s.question, s.transcript);
  // 講不清楚的字 = 目標句中 whisper 沒聽到(del)或聽成別的字(sub)的字
  const unclear = ops
    .filter((o) => (o.type === 'del' || o.type === 'sub') && (o.ref ?? '').length > 0)
    .map((o) => ({ word: o.ref!, heard: o.type === 'sub' ? o.hyp! : '' }));
  const feedback = { kind: 'shadow', accuracy, unclear, ops };
  db.prepare('UPDATE speaking_sessions SET feedback = ?, score100 = ? WHERE id = ?').run(
    JSON.stringify(feedback),
    Math.round(accuracy),
    s.id
  );
  res.json({ ok: true, accuracy: Math.round(accuracy), unclear, ops, transcript: s.transcript });
});

repeatRouter.delete('/repeat/materials/:id', (req, res) => {
  const m = db.prepare('SELECT audio_path FROM repeat_materials WHERE id = ?').get(req.params.id) as
    | { audio_path: string }
    | undefined;
  if (m?.audio_path) {
    const fp = path.join(UPLOADS_DIR, path.basename(m.audio_path));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('DELETE FROM repeat_materials WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM repeat_sessions WHERE material_id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** 開始一次四步跟讀 */
repeatRouter.post('/repeat/sessions', (req, res) => {
  const { material_id } = req.body as { material_id?: number };
  const m = db.prepare('SELECT id FROM repeat_materials WHERE id = ?').get(material_id);
  if (!m) return res.status(404).json({ error: '找不到素材' });
  const r = db
    .prepare('INSERT INTO repeat_sessions (material_id, date, created_at) VALUES (?,?,?)')
    .run(material_id, todayStr(), nowIso());
  res.json({ id: Number(r.lastInsertRowid) });
});

/** 更新步驟/漏聽原因/完成 */
repeatRouter.patch('/repeat/sessions/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM repeat_sessions WHERE id = ?').get(req.params.id) as
    | { id: number; reasons: string; step: number; done: number; recording_path: string }
    | undefined;
  if (!s) return res.status(404).json({ error: '找不到跟讀紀錄' });
  const { reasons, step, done } = req.body as {
    reasons?: Record<string, number>;
    step?: number;
    done?: boolean;
  };
  db.prepare('UPDATE repeat_sessions SET reasons = ?, step = ?, done = ? WHERE id = ?').run(
    reasons ? JSON.stringify(reasons) : s.reasons,
    typeof step === 'number' ? step : s.step,
    done === undefined ? s.done : done ? 1 : 0,
    s.id
  );
  res.json({ ok: true });
});

/** 步驟錄音(複誦/跟讀) */
repeatRouter.post('/repeat/sessions/:id/recording', recUpload.single('audio'), (req, res) => {
  const s = db.prepare('SELECT id FROM repeat_sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到跟讀紀錄' });
  if (!req.file) return res.status(400).json({ error: '沒有收到音檔' });
  const rel = `/recordings/${req.file.filename}`;
  db.prepare('UPDATE repeat_sessions SET recording_path = ? WHERE id = ?').run(rel, req.params.id);
  res.json({ ok: true, recording_path: rel });
});

/** 漏聽原因統計(聽力筆記自動化) */
repeatRouter.get('/repeat/stats', (_req, res) => {
  const rows = db.prepare('SELECT reasons, date FROM repeat_sessions').all() as {
    reasons: string;
    date: string;
  }[];
  const totals: Record<string, number> = { 連音: 0, 弱讀: 0, 生字: 0, 語速: 0 };
  for (const r of rows) {
    try {
      const obj = JSON.parse(r.reasons) as Record<string, number>;
      for (const [k, v] of Object.entries(obj)) totals[k] = (totals[k] ?? 0) + v;
    } catch {
      /* skip */
    }
  }
  const sessionCount = rows.length;
  res.json({ totals, sessionCount });
});
