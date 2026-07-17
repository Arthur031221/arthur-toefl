import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, SEEDS_DIR } from '../db.ts';
import { getFeedback } from '../aiService.ts';
import { countWords, nowIso, todayStr } from '../util.ts';

export const writingRouter = Router();

const FLEX_ITEM: Record<string, string> = {
  email: 'Write an Email',
  discussion: 'Academic Discussion',
};

/** 零件庫(附錄 E) */
writingRouter.get('/writing/parts', (_req, res) => {
  res.json(JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, 'parts_library.json'), 'utf8')));
});

/** 題庫列表 */
writingRouter.get('/writing/prompts', (req, res) => {
  const kind = req.query.kind as string | undefined;
  const rows = kind
    ? db.prepare('SELECT * FROM writing_prompts WHERE kind = ? ORDER BY id').all(kind)
    : db.prepare('SELECT * FROM writing_prompts ORDER BY id').all();
  res.json(rows);
});

/** 自貼題目 */
writingRouter.post('/writing/prompts', (req, res) => {
  const { kind, title, prompt } = req.body as { kind?: string; title?: string; prompt?: string };
  if ((kind !== 'email' && kind !== 'discussion') || !prompt?.trim()) {
    return res.status(400).json({ error: '需要 kind(email|discussion) 與 prompt' });
  }
  const r = db
    .prepare("INSERT INTO writing_prompts (kind, title, prompt, source, created_at) VALUES (?,?,?,'custom',?)")
    .run(kind, title?.trim() || '自訂題目', prompt.trim(), nowIso());
  res.json(db.prepare('SELECT * FROM writing_prompts WHERE id = ?').get(r.lastInsertRowid));
});

/** AI 出題(不耗 Flex) */
writingRouter.post('/writing/generate', async (req, res) => {
  const { kind } = req.body as { kind?: string };
  if (kind !== 'email' && kind !== 'discussion') {
    return res.status(400).json({ error: 'kind 必須是 email 或 discussion' });
  }
  const existing = db
    .prepare('SELECT title FROM writing_prompts WHERE kind = ? ORDER BY id DESC LIMIT 20')
    .all(kind) as { title: string }[];
  try {
    const r = await getFeedback(kind === 'email' ? 'gen_email' : 'gen_discussion', {
      exclude: existing.map((e) => e.title).join('、') || '(無)',
    });
    const parsed = r.parsed as { title?: string; prompt?: string } | null;
    if (!parsed?.prompt) {
      return res.status(502).json({ error: 'AI 回傳格式不符,請重試', raw: r.text.slice(0, 500) });
    }
    const ins = db
      .prepare("INSERT INTO writing_prompts (kind, title, prompt, source, created_at) VALUES (?,?,?,'ai',?)")
      .run(kind, parsed.title || 'AI 出題', parsed.prompt, nowIso());
    res.json(db.prepare('SELECT * FROM writing_prompts WHERE id = ?').get(ins.lastInsertRowid));
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** 開始練習(建 draft;作答自動保存,AI 失敗不丟失) */
writingRouter.post('/writing/sessions', (req, res) => {
  const { kind, prompt_id, prompt_text } = req.body as {
    kind?: string;
    prompt_id?: number;
    prompt_text?: string;
  };
  if ((kind !== 'email' && kind !== 'discussion') || !prompt_text?.trim()) {
    return res.status(400).json({ error: '需要 kind 與 prompt_text' });
  }
  const r = db
    .prepare(
      'INSERT INTO writing_sessions (kind, prompt_id, prompt_text, date, created_at) VALUES (?,?,?,?,?)'
    )
    .run(kind, prompt_id ?? null, prompt_text, todayStr(), nowIso());
  res.json({ id: Number(r.lastInsertRowid) });
});

/** 自動保存/更新作答 */
writingRouter.patch('/writing/sessions/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM writing_sessions WHERE id = ?').get(req.params.id) as
    | { id: number; answer: string; seconds_used: number; overtime: number; status: string }
    | undefined;
  if (!s) return res.status(404).json({ error: '找不到練習紀錄' });
  const { answer, seconds_used, overtime, status } = req.body as {
    answer?: string;
    seconds_used?: number;
    overtime?: boolean;
    status?: string;
  };
  const newAnswer = typeof answer === 'string' ? answer : s.answer;
  db.prepare(
    'UPDATE writing_sessions SET answer = ?, seconds_used = ?, overtime = ?, word_count = ?, status = ? WHERE id = ?'
  ).run(
    newAnswer,
    typeof seconds_used === 'number' ? Math.round(seconds_used) : s.seconds_used,
    overtime === undefined ? s.overtime : overtime ? 1 : 0,
    countWords(newAnswer),
    status ?? s.status,
    s.id
  );
  res.json({ ok: true, word_count: countWords(newAnswer) });
});

/** AI 批改 */
writingRouter.post('/writing/sessions/:id/grade', async (req, res) => {
  const s = db.prepare('SELECT * FROM writing_sessions WHERE id = ?').get(req.params.id) as
    | { id: number; kind: string; prompt_text: string; answer: string }
    | undefined;
  if (!s) return res.status(404).json({ error: '找不到練習紀錄' });
  if (!s.answer.trim()) return res.status(400).json({ error: '作答內容是空的' });

  try {
    const r = await getFeedback(s.kind === 'email' ? 'grade_email' : 'grade_discussion', {
      prompt: s.prompt_text,
      answer: s.answer,
    });
    const parsed = (r.parsed ?? {}) as { score?: number; score100?: number };
    db.prepare(
      "UPDATE writing_sessions SET feedback = ?, score = ?, score100 = ?, status = 'graded' WHERE id = ?"
    ).run(
      JSON.stringify(r.parsed ?? { raw: r.text }),
      typeof parsed.score === 'number' ? parsed.score : null,
      typeof parsed.score100 === 'number' ? parsed.score100 : null,
      s.id
    );
    res.json({ ok: true, parsed: r.parsed, raw: r.text, provider: r.provider, ms: r.ms });
  } catch (e) {
    // 失敗不動 answer,可重試
    res.status(502).json({ error: (e as Error).message });
  }
});

/** 標記/取消 Flex 消耗(連動配額) */
writingRouter.post('/writing/sessions/:id/flex', (req, res) => {
  const s = db.prepare('SELECT * FROM writing_sessions WHERE id = ?').get(req.params.id) as
    | { id: number; kind: string; used_flex: number }
    | undefined;
  if (!s) return res.status(404).json({ error: '找不到練習紀錄' });
  const item = FLEX_ITEM[s.kind];
  const q = db.prepare('SELECT * FROM quota WHERE item = ?').get(item) as
    | { total: number; used: number; reserve: number }
    | undefined;
  if (!q) return res.status(500).json({ error: `配額表缺少 ${item}` });

  const tx = db.transaction(() => {
    if (s.used_flex === 0) {
      if (q.used >= q.total) throw new Error(`「${item}」配額已用完`);
      db.prepare('UPDATE quota SET used = used + 1 WHERE item = ?').run(item);
      db.prepare('INSERT INTO quota_log (item, delta, date, note) VALUES (?,1,?,?)').run(
        item,
        todayStr(),
        `寫作練習 #${s.id}`
      );
      db.prepare('UPDATE writing_sessions SET used_flex = 1 WHERE id = ?').run(s.id);
    } else {
      db.prepare('UPDATE quota SET used = MAX(0, used - 1) WHERE item = ?').run(item);
      db.prepare('INSERT INTO quota_log (item, delta, date, note) VALUES (?,-1,?,?)').run(
        item,
        todayStr(),
        `取消寫作練習 #${s.id} 的標記`
      );
      db.prepare('UPDATE writing_sessions SET used_flex = 0 WHERE id = ?').run(s.id);
    }
  });
  try {
    tx();
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  const updated = db.prepare('SELECT used, total, reserve FROM quota WHERE item = ?').get(item) as {
    used: number;
    total: number;
    reserve: number;
  };
  const remaining = updated.total - updated.used;
  res.json({
    ok: true,
    used_flex: s.used_flex === 0 ? 1 : 0,
    remaining,
    lowWarning: remaining <= updated.reserve,
  });
});

/** 歷史+趨勢 */
writingRouter.get('/writing/sessions', (req, res) => {
  const kind = req.query.kind as string | undefined;
  const rows = kind
    ? db.prepare('SELECT * FROM writing_sessions WHERE kind = ? ORDER BY id DESC LIMIT 100').all(kind)
    : db.prepare('SELECT * FROM writing_sessions ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

writingRouter.get('/writing/sessions/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM writing_sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到練習紀錄' });
  res.json(s);
});

writingRouter.delete('/writing/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM writing_sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
