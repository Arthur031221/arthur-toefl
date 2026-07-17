import { Router } from 'express';
import { db } from '../db.ts';
import { nowIso, todayStr, addDays } from '../util.ts';

export const spellingRouter = Router();

interface WordRow {
  id: number;
  word: string;
  grp: string;
  hint: string;
  correct_streak: number;
  wrong_count: number;
  retry_left: number;
  retry_date: string;
  last_seen: string;
}

spellingRouter.get('/spelling/words', (req, res) => {
  const grp = req.query.grp as string | undefined;
  const rows =
    grp && grp !== 'all'
      ? db.prepare('SELECT * FROM spelling_words WHERE grp = ? ORDER BY word').all(grp)
      : db.prepare('SELECT * FROM spelling_words ORDER BY grp, word').all();
  res.json(rows);
});

spellingRouter.post('/spelling/words', (req, res) => {
  const { word, grp, hint } = req.body as Record<string, string | undefined>;
  if (!word?.trim() || (grp !== 'personal' && grp !== 'academic')) {
    return res.status(400).json({ error: '需要 word 與 grp(personal|academic)' });
  }
  const r = db
    .prepare('INSERT OR IGNORE INTO spelling_words (word, grp, hint, created_at) VALUES (?,?,?,?)')
    .run(word.trim(), grp, hint?.trim() ?? '', nowIso());
  if (r.changes === 0) return res.status(409).json({ error: '這個字已在詞庫中' });
  res.json(db.prepare('SELECT * FROM spelling_words WHERE id = ?').get(r.lastInsertRowid));
});

spellingRouter.delete('/spelling/words/:id', (req, res) => {
  db.prepare('DELETE FROM spelling_words WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** 加權抽下一題:今日重打佇列優先,新錯字高頻,答對3次降頻 */
spellingRouter.get('/spelling/next', (req, res) => {
  const grp = (req.query.grp as string) || 'all';
  const exclude = Number(req.query.exclude) || 0; // 避免同字連續出現
  const today = todayStr();
  let rows = (
    grp === 'all'
      ? db.prepare('SELECT * FROM spelling_words').all()
      : db.prepare('SELECT * FROM spelling_words WHERE grp = ?').all(grp)
  ) as WordRow[];
  if (rows.length === 0) return res.status(404).json({ error: '詞庫是空的' });
  if (rows.length > 1) rows = rows.filter((w) => w.id !== exclude);

  const weight = (w: WordRow): number => {
    if (w.retry_left > 0 && w.retry_date === today) return 12; // 今日重打佇列
    if (w.correct_streak >= 3) return 1; // 已熟練 → 降頻
    return 3 + Math.min(w.wrong_count * 2, 6); // 錯越多權重越高
  };
  const total = rows.reduce((s, w) => s + weight(w), 0);
  let roll = Math.random() * total;
  let picked = rows[0];
  for (const w of rows) {
    roll -= weight(w);
    if (roll <= 0) {
      picked = w;
      break;
    }
  }
  const queueCount = (
    db
      .prepare('SELECT COUNT(*) AS n FROM spelling_words WHERE retry_left > 0 AND retry_date = ?')
      .get(today) as { n: number }
  ).n;
  res.json({
    id: picked.id,
    grp: picked.grp,
    hint: picked.hint,
    first2: picked.word.slice(0, 2),
    length: picked.word.length,
    inRetryQueue: picked.retry_left > 0 && picked.retry_date === today,
    queueCount,
  });
});

/** 判答 */
spellingRouter.post('/spelling/answer', (req, res) => {
  const { id, answer } = req.body as { id?: number; answer?: string };
  const w = db.prepare('SELECT * FROM spelling_words WHERE id = ?').get(id) as WordRow | undefined;
  if (!w) return res.status(404).json({ error: '找不到這個字' });
  const today = todayStr();
  const correct = (answer ?? '').trim().toLowerCase() === w.word.toLowerCase();

  if (correct) {
    const newRetry = w.retry_left > 0 && w.retry_date === today ? w.retry_left - 1 : w.retry_left > 0 ? 0 : 0;
    db.prepare(
      'UPDATE spelling_words SET correct_streak = correct_streak + 1, retry_left = ?, last_seen = ? WHERE id = ?'
    ).run(newRetry, today, w.id);
  } else {
    db.prepare(
      "UPDATE spelling_words SET correct_streak = 0, wrong_count = wrong_count + 1, retry_left = 3, retry_date = ?, last_seen = ? WHERE id = ?"
    ).run(today, today, w.id);
  }
  db.prepare('INSERT INTO spelling_attempts (word_id, correct, date, created_at) VALUES (?,?,?,?)').run(
    w.id,
    correct ? 1 : 0,
    today,
    nowIso()
  );
  res.json({ correct, word: w.word, hint: w.hint });
});

/** 統計:熟練度 + 近14天正確率 */
spellingRouter.get('/spelling/stats', (_req, res) => {
  const today = todayStr();
  const totals = db
    .prepare(
      `SELECT grp, COUNT(*) AS total, SUM(CASE WHEN correct_streak >= 3 THEN 1 ELSE 0 END) AS mastered
       FROM spelling_words GROUP BY grp`
    )
    .all();
  const queue = db
    .prepare('SELECT word, retry_left FROM spelling_words WHERE retry_left > 0 AND retry_date = ?')
    .all(today);
  const daily: { date: string; total: number; correct: number; acc: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const row = db
      .prepare('SELECT COUNT(*) AS total, SUM(correct) AS ok FROM spelling_attempts WHERE date = ?')
      .get(d) as { total: number; ok: number | null };
    daily.push({
      date: d.slice(5),
      total: row.total,
      correct: row.ok ?? 0,
      acc: row.total > 0 ? Math.round(((row.ok ?? 0) / row.total) * 100) : 0,
    });
  }
  res.json({ totals, queue, daily });
});
