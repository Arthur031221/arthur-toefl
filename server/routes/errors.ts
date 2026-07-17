import { Router } from 'express';
import { db } from '../db.ts';
import { nowIso, todayStr, weekStartOf, addDays } from '../util.ts';

export const errorsRouter = Router();

export const CATS = ['單複數/冠詞', '時態/三單', '拼寫', '固定搭配'] as const;

export function normalizeCat(raw: string): string {
  if ((CATS as readonly string[]).includes(raw)) return raw;
  if (/拼/.test(raw) || /spell/i.test(raw)) return '拼寫';
  if (/冠詞|單複數|複數|plural|article/i.test(raw)) return '單複數/冠詞';
  if (/時態|三單|tense/i.test(raw)) return '時態/三單';
  return '固定搭配';
}

/** 錯字自動加入拼寫詞庫(聽寫/批改共用) */
export function addWordToSpelling(word: string): void {
  const clean = word.trim();
  if (!/^[A-Za-z][A-Za-z'-]{1,30}$/.test(clean)) return;
  db.prepare(
    "INSERT OR IGNORE INTO spelling_words (word, grp, hint, created_at) VALUES (?,'personal','(自動加入)',?)"
  ).run(clean, nowIso());
}

errorsRouter.get('/errors', (req, res) => {
  const cat = req.query.cat as string | undefined;
  const rows =
    cat && cat !== 'all'
      ? db.prepare('SELECT * FROM error_book WHERE cat = ? ORDER BY id DESC').all(cat)
      : db.prepare('SELECT * FROM error_book ORDER BY id DESC').all();
  res.json(rows);
});

errorsRouter.post('/errors', (req, res) => {
  const { cat, wrong, correct, note, source } = req.body as Record<string, string | undefined>;
  if (!cat || !wrong?.trim() || !correct?.trim()) {
    return res.status(400).json({ error: '需要 cat / wrong / correct' });
  }
  const r = db
    .prepare('INSERT INTO error_book (cat, wrong, correct, note, source, created_at) VALUES (?,?,?,?,?,?)')
    .run(normalizeCat(cat), wrong.trim(), correct.trim(), note?.trim() ?? '', source?.trim() || '手動', nowIso());
  // 拼寫類自動流入拼寫詞庫
  if (normalizeCat(cat) === '拼寫') addWordToSpelling(correct);
  res.json(db.prepare('SELECT * FROM error_book WHERE id = ?').get(r.lastInsertRowid));
});

/** AI 批改結果一鍵全部加入 */
errorsRouter.post('/errors/bulk', (req, res) => {
  const { errors, source } = req.body as {
    errors?: { category?: string; cat?: string; wrong?: string; correct?: string; note?: string }[];
    source?: string;
  };
  if (!Array.isArray(errors) || errors.length === 0) {
    return res.status(400).json({ error: 'errors 陣列是空的' });
  }
  const ins = db.prepare(
    'INSERT INTO error_book (cat, wrong, correct, note, source, created_at) VALUES (?,?,?,?,?,?)'
  );
  let added = 0;
  const tx = db.transaction(() => {
    for (const e of errors) {
      const wrong = e.wrong?.trim();
      const correct = e.correct?.trim();
      if (!wrong || !correct) continue;
      // 同錯誤已存在 → 正字計數 +1 而不是重複建檔
      const dup = db
        .prepare('SELECT id FROM error_book WHERE wrong = ? AND correct = ?')
        .get(wrong, correct) as { id: number } | undefined;
      if (dup) {
        db.prepare('UPDATE error_book SET repeat_count = repeat_count + 1 WHERE id = ?').run(dup.id);
      } else {
        const cat = normalizeCat(e.category ?? e.cat ?? '');
        ins.run(cat, wrong, correct, e.note?.trim() ?? '', source?.trim() || 'AI批改', nowIso());
        if (cat === '拼寫') addWordToSpelling(correct);
      }
      added++;
    }
  });
  tx();
  res.json({ ok: true, added });
});

/** 再犯 +1 */
errorsRouter.post('/errors/:id/repeat', (req, res) => {
  const r = db
    .prepare('UPDATE error_book SET repeat_count = repeat_count + 1 WHERE id = ?')
    .run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: '找不到紀錄' });
  res.json(db.prepare('SELECT * FROM error_book WHERE id = ?').get(req.params.id));
});

errorsRouter.patch('/errors/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM error_book WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return res.status(404).json({ error: '找不到紀錄' });
  const { cat, wrong, correct, note } = req.body as Record<string, string | undefined>;
  db.prepare('UPDATE error_book SET cat = ?, wrong = ?, correct = ?, note = ? WHERE id = ?').run(
    cat ? normalizeCat(cat) : row.cat,
    wrong ?? row.wrong,
    correct ?? row.correct,
    note ?? row.note,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM error_book WHERE id = ?').get(req.params.id));
});

errorsRouter.delete('/errors/:id', (req, res) => {
  db.prepare('DELETE FROM error_book WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** 分類統計 + 本週新增 + W8 紅線 + 週序列 */
errorsRouter.get('/errors/stats', (_req, res) => {
  const today = todayStr();
  const weekStart = weekStartOf(today);
  const byCat = db
    .prepare('SELECT cat, COUNT(*) AS n, SUM(repeat_count) AS repeats FROM error_book GROUP BY cat')
    .all() as { cat: string; n: number; repeats: number | null }[];
  const weeklyNew = (
    db
      .prepare('SELECT COUNT(*) AS n FROM error_book WHERE created_at >= ?')
      .get(weekStart + 'T00:00:00.000Z') as { n: number }
  ).n;

  // 近 8 週每週新增
  const series: { week: string; n: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const ws = addDays(weekStart, -7 * i);
    const we = addDays(ws, 7);
    const n = (
      db
        .prepare('SELECT COUNT(*) AS n FROM error_book WHERE created_at >= ? AND created_at < ?')
        .get(ws + 'T00:00:00.000Z', we + 'T00:00:00.000Z') as { n: number }
    ).n;
    series.push({ week: ws.slice(5), n });
  }

  const w8Active = today >= '2026-09-07';
  res.json({
    cats: CATS,
    byCat,
    weeklyNew,
    weekStart,
    w8Warning: w8Active && weeklyNew >= 5,
    w8Active,
    weeklySeries: series,
    total: byCat.reduce((s, c) => s + c.n, 0),
  });
});
