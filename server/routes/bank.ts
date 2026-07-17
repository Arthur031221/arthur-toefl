import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, SEEDS_DIR } from '../db.ts';
import { getFeedback, type FeedbackKind } from '../aiService.ts';
import { validators } from '../bankValidate.ts';
import { nowIso, todayStr, addDays } from '../util.ts';
import { addWordToSpelling } from './errors.ts';

export const bankRouter = Router();

export const QTYPE_SECTION: Record<string, string> = {
  ctw: 'reading',
  daily_life: 'reading',
  academic: 'reading',
  lcr: 'listening',
  conversation: 'listening',
  announcement: 'listening',
  talk: 'listening',
  build_sentence: 'writing',
  lnr_set: 'speaking',
};

function titleOf(qtype: string, d: Record<string, unknown>): string {
  switch (qtype) {
    case 'ctw':
    case 'academic':
    case 'daily_life':
      return String(d.title ?? '');
    case 'lcr':
      return String(d.stimulus ?? '').slice(0, 60);
    case 'conversation':
    case 'announcement':
      return String(d.setting ?? '');
    case 'talk':
      return String(d.topic ?? '');
    case 'build_sentence':
      return String(d.context ?? '').slice(0, 60);
    case 'lnr_set':
      return String(d.title ?? '');
    default:
      return '';
  }
}

function insertItem(qtype: string, data: Record<string, unknown>, source: string): boolean {
  const r = db
    .prepare(
      'INSERT OR IGNORE INTO bank_items (section, qtype, item_id, title, data, source, created_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run(
      QTYPE_SECTION[qtype],
      qtype,
      String(data.id),
      titleOf(qtype, data),
      JSON.stringify(data),
      source,
      nowIso()
    );
  return r.changes > 0;
}

/** 種子題庫載入(冪等,item_id UNIQUE 擋重複) */
export function seedBanks(): void {
  const files: { file: string; map: Record<string, string> }[] = [
    { file: 'bank_reading.json', map: { ctw: 'ctw', daily_life: 'daily_life', academic: 'academic' } },
    {
      file: 'bank_listening.json',
      map: { lcr: 'lcr', conversation: 'conversation', announcement: 'announcement', talk: 'talk' },
    },
    { file: 'bank_writing_speaking.json', map: { build_sentence: 'build_sentence', lnr_sets: 'lnr_set' } },
  ];
  let added = 0;
  for (const { file, map } of files) {
    const p = path.join(SEEDS_DIR, file);
    if (!fs.existsSync(p)) continue;
    let parsed: Record<string, unknown[]>;
    try {
      parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.error(`[bank] ${file} 解析失敗:${(e as Error).message}`);
      continue;
    }
    for (const [key, qtype] of Object.entries(map)) {
      const items = parsed[key];
      if (!Array.isArray(items)) continue;
      const v = validators[qtype];
      for (const item of items) {
        const err = v ? v(item) : null;
        if (err) {
          console.error(`[bank] ${file} 跳過不合格項目:${err}`);
          continue;
        }
        if (insertItem(qtype, item as Record<string, unknown>, 'seed')) added++;
      }
    }
  }
  if (added > 0) console.log(`[bank] 題庫載入 ${added} 題 ✓`);
}

/** 題庫列表(含練習統計) */
bankRouter.get('/bank', (req, res) => {
  const qtype = req.query.qtype as string | undefined;
  const rows = (
    qtype
      ? db.prepare('SELECT id, section, qtype, item_id, title, source, created_at FROM bank_items WHERE qtype = ? ORDER BY id').all(qtype)
      : db.prepare('SELECT id, section, qtype, item_id, title, source, created_at FROM bank_items ORDER BY qtype, id').all()
  ) as { item_id: string }[];
  const stats = db
    .prepare('SELECT item_id, COUNT(*) AS attempts, MAX(accuracy) AS best, AVG(accuracy) AS avg FROM practice_results GROUP BY item_id')
    .all() as { item_id: string; attempts: number; best: number; avg: number }[];
  const statMap = new Map(stats.map((s) => [s.item_id, s]));
  res.json(
    rows.map((r) => ({
      ...r,
      attempts: statMap.get(r.item_id)?.attempts ?? 0,
      best: statMap.get(r.item_id)?.best ?? null,
    }))
  );
});

/** 取單題完整內容 */
bankRouter.get('/bank/item/:itemId', (req, res) => {
  const row = db.prepare('SELECT * FROM bank_items WHERE item_id = ?').get(req.params.itemId) as
    | { data: string; qtype: string; section: string }
    | undefined;
  if (!row) return res.status(404).json({ error: '找不到題目' });
  res.json({ ...row, data: JSON.parse(row.data) });
});

bankRouter.delete('/bank/item/:itemId', (req, res) => {
  db.prepare('DELETE FROM bank_items WHERE item_id = ?').run(req.params.itemId);
  res.json({ ok: true });
});

const GEN_KIND: Record<string, FeedbackKind> = {
  ctw: 'gen_ctw',
  daily_life: 'gen_daily_life',
  academic: 'gen_academic',
  lcr: 'gen_lcr',
  conversation: 'gen_conversation',
  announcement: 'gen_announcement',
  talk: 'gen_talk',
  build_sentence: 'gen_build_sentence',
} as Record<string, FeedbackKind>;

/** AI 出題(練不完的來源;不耗 Flex) */
bankRouter.post('/bank/generate', async (req, res) => {
  const { qtype } = req.body as { qtype?: string };
  if (!qtype || !GEN_KIND[qtype]) return res.status(400).json({ error: `不支援的題型 ${qtype}` });
  const recent = db
    .prepare('SELECT title FROM bank_items WHERE qtype = ? ORDER BY id DESC LIMIT 15')
    .all(qtype) as { title: string }[];
  try {
    const r = await getFeedback(GEN_KIND[qtype], {
      exclude: recent.map((x) => x.title).join('、') || '(無)',
    });
    const item = r.parsed as Record<string, unknown> | null;
    if (!item) return res.status(502).json({ error: 'AI 回傳不是 JSON,請重試', raw: r.text.slice(0, 300) });
    item.id = `${qtype}-ai-${Date.now().toString(36)}`;
    const err = validators[qtype]?.(item);
    if (err) return res.status(502).json({ error: `AI 出題不合格式(${err}),請重試` });
    insertItem(qtype, item, 'ai');
    res.json({ ok: true, item_id: item.id, data: item });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** 交卷:記錄練習結果 */
bankRouter.post('/practice/results', (req, res) => {
  const { qtype, item_id, correct, total, seconds, detail } = req.body as {
    qtype?: string;
    item_id?: string;
    correct?: number;
    total?: number;
    seconds?: number;
    detail?: unknown;
  };
  if (!qtype || !QTYPE_SECTION[qtype] || !item_id || typeof correct !== 'number' || typeof total !== 'number' || total <= 0) {
    return res.status(400).json({ error: '需要 qtype/item_id/correct/total' });
  }
  const accuracy = Math.round((correct / total) * 1000) / 10;
  db.prepare(
    'INSERT INTO practice_results (section, qtype, item_id, correct, total, accuracy, seconds, detail, date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    QTYPE_SECTION[qtype],
    qtype,
    item_id,
    correct,
    total,
    accuracy,
    Math.round(seconds ?? 0),
    JSON.stringify(detail ?? {}),
    todayStr(),
    nowIso()
  );
  // CTW 打錯的字自動流入拼寫詞庫
  const det = detail as { wrongWords?: string[] } | undefined;
  const added: string[] = [];
  if (qtype === 'ctw' && Array.isArray(det?.wrongWords)) {
    for (const w of det.wrongWords.slice(0, 10)) {
      addWordToSpelling(w);
      added.push(w);
    }
  }
  res.json({ ok: true, accuracy, wordsAddedToSpelling: added });
});

/** 練習統計:每題型總覽+近 30 天日正確率 */
bankRouter.get('/practice/stats', (_req, res) => {
  const totals = db
    .prepare(
      'SELECT qtype, COUNT(*) AS attempts, AVG(accuracy) AS avg, SUM(total) AS questions FROM practice_results GROUP BY qtype'
    )
    .all();
  const from = addDays(todayStr(), -30);
  const daily = db
    .prepare(
      'SELECT date, qtype, AVG(accuracy) AS acc, COUNT(*) AS n FROM practice_results WHERE date >= ? GROUP BY date, qtype ORDER BY date'
    )
    .all(from);
  const bankCounts = db
    .prepare('SELECT qtype, COUNT(*) AS n FROM bank_items GROUP BY qtype')
    .all();
  res.json({ totals, daily, bankCounts });
});
