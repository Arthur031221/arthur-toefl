import { Router } from 'express';
import { db } from '../db.ts';
import { nowIso, todayStr, weekStartOf, addDays, isValidDate } from '../util.ts';

export const mockRouter = Router();

/** 四場模考 + 正式考的既定日程 */
const PLANNED = [
  { date: '2026-08-02', label: 'ETS Sample Test 1' },
  { date: '2026-08-23', label: 'ETS Sample Test 2' },
  { date: '2026-08-30', label: '付費 TPO(最準預測)' },
  { date: '2026-09-13', label: 'TST Prep 全真' },
  { date: '2026-09-19', label: '正式考' },
];

function totalOf(m: { r: number | null; l: number | null; w: number | null; s: number | null }): number | null {
  const vals = [m.r, m.l, m.w, m.s].filter((v): v is number => typeof v === 'number');
  if (vals.length < 4) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / 4) * 100) / 100;
}

mockRouter.get('/mock', (_req, res) => {
  const rows = db.prepare('SELECT * FROM mock_exams ORDER BY date, id').all() as {
    id: number;
    date: string;
    label: string;
    r: number | null;
    l: number | null;
    w: number | null;
    s: number | null;
    self_ws: number;
    note: string;
  }[];

  // 8/30 TPO 決策提示
  let decision: { total: number; verdict: string; detail: string } | null = null;
  const tpo = rows.filter((r) => r.date >= '2026-08-30').find((r) => totalOf(r) !== null) ??
    rows.filter((r) => r.date === '2026-08-30').find((r) => totalOf(r) !== null);
  const tpoRow = rows.find((r) => r.date === '2026-08-30' && totalOf(r) !== null) ?? tpo;
  if (tpoRow) {
    const total = totalOf(tpoRow)!;
    if (total >= 4.3) {
      decision = { total, verdict: '照計畫走', detail: '總分 ≥4.3:按原計畫衝 9/19,最後兩週補洞。' };
    } else if (total < 4.0) {
      decision = {
        total,
        verdict: '建議預約 10 月中二考',
        detail: '總分 <4.0:9/19 照考累積經驗,但現在就去預約 10 月中的二考場次,壓力會小很多。',
      };
    } else {
      decision = {
        total,
        verdict: '臨界區間',
        detail: '4.0–4.3:主攻最弱一科,9/13 全真後再判斷是否需要二考。',
      };
    }
  }

  res.json({
    planned: PLANNED,
    exams: rows.map((r) => ({ ...r, total: totalOf(r) })),
    decision,
  });
});

mockRouter.post('/mock', (req, res) => {
  const { date, label, r, l, w, s, self_ws, note } = req.body as Record<string, unknown>;
  if (!isValidDate(date) || !label) return res.status(400).json({ error: '需要 date 與 label' });
  const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
  const ins = db
    .prepare(
      'INSERT INTO mock_exams (date, label, r, l, w, s, self_ws, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(date, String(label), num(r), num(l), num(w), num(s), self_ws ? 1 : 0, String(note ?? ''), nowIso());
  res.json(db.prepare('SELECT * FROM mock_exams WHERE id = ?').get(ins.lastInsertRowid));
});

mockRouter.patch('/mock/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM mock_exams WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return res.status(404).json({ error: '找不到成績紀錄' });
  const merged = { ...row, ...req.body } as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
  db.prepare(
    'UPDATE mock_exams SET date = ?, label = ?, r = ?, l = ?, w = ?, s = ?, self_ws = ?, note = ? WHERE id = ?'
  ).run(
    String(merged.date),
    String(merged.label),
    num(merged.r),
    num(merged.l),
    num(merged.w),
    num(merged.s),
    merged.self_ws ? 1 : 0,
    String(merged.note ?? ''),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM mock_exams WHERE id = ?').get(req.params.id));
});

mockRouter.delete('/mock/:id', (req, res) => {
  db.prepare('DELETE FROM mock_exams WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ================= 每週日回顧 ================= */

const PLAN_WEEKS = [
  '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10',
  '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14',
];

/** 自動帶入該週資料 */
function autofill(weekStart: string) {
  const weekEnd = addDays(weekStart, 7);
  const deadair = db
    .prepare(
      "SELECT AVG(dead_air_count) AS avg, COUNT(*) AS n FROM speaking_sessions WHERE mode='interview' AND date >= ? AND date < ?"
    )
    .get(weekStart, weekEnd) as { avg: number | null; n: number };
  const writing = db
    .prepare('SELECT COUNT(*) AS n, AVG(score) AS avg FROM writing_sessions WHERE date >= ? AND date < ?')
    .get(weekStart, weekEnd) as { n: number; avg: number | null };
  const errorsNew = (
    db
      .prepare('SELECT COUNT(*) AS n FROM error_book WHERE created_at >= ? AND created_at < ?')
      .get(weekStart + 'T00:00:00.000Z', weekEnd + 'T00:00:00.000Z') as { n: number }
  ).n;
  const dictation = db
    .prepare('SELECT AVG(accuracy) AS avg, COUNT(*) AS n FROM dictation_attempts WHERE date >= ? AND date < ?')
    .get(weekStart, weekEnd) as { avg: number | null; n: number };
  const byType = (qtype: string) =>
    db
      .prepare('SELECT AVG(accuracy) AS avg, COUNT(*) AS n FROM practice_results WHERE qtype = ? AND date >= ? AND date < ?')
      .get(qtype, weekStart, weekEnd) as { avg: number | null; n: number };
  const ctw = byType('ctw');
  const ann = byType('announcement');
  return {
    deadairAvg: deadair.avg !== null ? Math.round(deadair.avg * 10) / 10 : null,
    speakingCount: deadair.n,
    writingCount: writing.n,
    writingAvgScore: writing.avg !== null ? Math.round(writing.avg * 10) / 10 : null,
    errorsNew,
    dictationAcc: dictation.avg !== null ? Math.round(dictation.avg * 10) / 10 : null,
    dictationCount: dictation.n,
    ctwAcc: ctw.avg !== null ? Math.round(ctw.avg * 10) / 10 : null,
    ctwCount: ctw.n,
    annAcc: ann.avg !== null ? Math.round(ann.avg * 10) / 10 : null,
    annCount: ann.n,
  };
}

mockRouter.get('/review', (_req, res) => {
  const saved = db.prepare('SELECT * FROM weekly_reviews ORDER BY week_start').all() as {
    week_start: string;
  }[];
  const savedMap = new Map(saved.map((s) => [s.week_start, s]));
  const today = todayStr();
  const currentWeek = weekStartOf(today);
  res.json({
    currentWeek,
    weeks: PLAN_WEEKS.map((ws, i) => ({
      week_start: ws,
      label: `W${i}(${ws.slice(5)} 週)`,
      isCurrent: ws === currentWeek,
      isPast: ws < currentWeek,
      saved: savedMap.get(ws) ?? null,
      autofill: autofill(ws),
    })),
  });
});

mockRouter.put('/review', (req, res) => {
  const { week_start, ctw_acc, ann_acc, selfcheck_catches, deadair_avg, next_week } = req.body as Record<
    string,
    unknown
  >;
  if (!isValidDate(week_start)) return res.status(400).json({ error: '需要 week_start(週一日期)' });
  const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
  db.prepare(
    `INSERT INTO weekly_reviews (week_start, ctw_acc, ann_acc, selfcheck_catches, deadair_avg, next_week, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(week_start) DO UPDATE SET ctw_acc=excluded.ctw_acc, ann_acc=excluded.ann_acc,
       selfcheck_catches=excluded.selfcheck_catches, deadair_avg=excluded.deadair_avg, next_week=excluded.next_week`
  ).run(
    week_start,
    num(ctw_acc),
    num(ann_acc),
    num(selfcheck_catches),
    num(deadair_avg),
    String(next_week ?? ''),
    nowIso()
  );
  res.json(db.prepare('SELECT * FROM weekly_reviews WHERE week_start = ?').get(week_start));
});
