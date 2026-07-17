import { Router } from 'express';
import { db } from '../db.ts';
import { EXAM_DATE, todayStr, diffDays, isValidDate, nowIso } from '../util.ts';
import {
  getPlanDay,
  getAllPlanDays,
  buildItems,
  dayStat,
  calcStreak,
  MILESTONES,
  typeLabel,
} from '../planLogic.ts';

export const coreRouter = Router();

/** Dashboard 首頁資料 */
coreRouter.get('/dashboard', (req, res) => {
  const today = isValidDate(req.query.date) ? (req.query.date as string) : todayStr();
  const daysLeft = diffDays(today, EXAM_DATE);
  const day = getPlanDay(today);
  const allDays = getAllPlanDays();
  const planStart = allDays[0]?.date ?? '';
  const planEnd = allDays[allDays.length - 1]?.date ?? '';

  const carryover = db
    .prepare('SELECT * FROM carryover WHERE to_date = ? ORDER BY id')
    .all(today) as unknown[];

  const latestMock = db
    .prepare('SELECT * FROM mock_exams ORDER BY date DESC, id DESC LIMIT 1')
    .get() as unknown;

  const targets = {
    R: { from: 4.0, to: 5.0 },
    L: { from: 4.0, to: 5.0 },
    W: { from: 2.0, to: 4.5 },
    S: { from: 1.0, to: 4.0 },
  };

  res.json({
    today,
    examDate: EXAM_DATE,
    daysLeft,
    planStart,
    planEnd,
    streak: calcStreak(today),
    day: day
      ? {
          ...day,
          videos: JSON.parse(day.videos),
          typeLabel: typeLabel(day.type),
          items: buildItems(day),
          stat: dayStat(day),
        }
      : null,
    carryover,
    latestMock: latestMock ?? null,
    targets,
  });
});

/** 勾選/取消每日任務 */
coreRouter.post('/checks', (req, res) => {
  const { date, item, done } = req.body as { date?: string; item?: string; done?: boolean };
  if (!isValidDate(date) || !item || typeof done !== 'boolean') {
    return res.status(400).json({ error: '參數錯誤:需要 date/item/done' });
  }
  if (done) {
    db.prepare(
      'INSERT INTO daily_checks (date, item, done, done_at) VALUES (?,?,1,?) ON CONFLICT(date, item) DO UPDATE SET done = 1, done_at = excluded.done_at'
    ).run(date, item, nowIso());
  } else {
    db.prepare('DELETE FROM daily_checks WHERE date = ? AND item = ?').run(date, item);
  }
  const day = getPlanDay(date);
  res.json({ ok: true, stat: day ? dayStat(day) : null, streak: calcStreak(todayStr()) });
});

/** 順延任務完成勾選 */
coreRouter.patch('/carryover/:id', (req, res) => {
  const { done } = req.body as { done?: boolean };
  db.prepare('UPDATE carryover SET done = ? WHERE id = ?').run(done ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

/** 65 天計畫全覽(月曆/列表) */
coreRouter.get('/plan', (_req, res) => {
  const days = getAllPlanDays();
  const carryoverCounts = db
    .prepare('SELECT to_date, COUNT(*) AS n FROM carryover GROUP BY to_date')
    .all() as { to_date: string; n: number }[];
  const coMap = new Map(carryoverCounts.map((c) => [c.to_date, c.n]));
  const today = todayStr();
  res.json({
    today,
    milestones: MILESTONES,
    days: days.map((d) => ({
      ...d,
      videos: JSON.parse(d.videos),
      typeLabel: typeLabel(d.type),
      stat: dayStat(d),
      carryoverIn: coMap.get(d.date) ?? 0,
      isPast: d.date < today,
      isToday: d.date === today,
    })),
  });
});

/** 單日詳情 */
coreRouter.get('/plan/:date', (req, res) => {
  const day = getPlanDay(req.params.date);
  if (!day) return res.status(404).json({ error: '該日期不在 65 天計畫內' });
  const carryover = db
    .prepare('SELECT * FROM carryover WHERE to_date = ? ORDER BY id')
    .all(day.date);
  res.json({
    ...day,
    videos: JSON.parse(day.videos),
    typeLabel: typeLabel(day.type),
    items: buildItems(day),
    stat: dayStat(day),
    carryover,
  });
});

/** 標為沒做到並順延關鍵任務到隔天(僅練習類;模考/考試不可) */
coreRouter.post('/plan/:date/postpone', (req, res) => {
  const day = getPlanDay(req.params.date);
  if (!day) return res.status(404).json({ error: '該日期不在計畫內' });
  if (day.type === 'mock' || day.type === 'exam') {
    return res.status(400).json({ error: '模考/考試日不可順延' });
  }
  if (day.missed === 1) {
    return res.status(400).json({ error: '這天已經順延過了' });
  }

  // 找下一個非模考日
  const all = getAllPlanDays();
  const idx = all.findIndex((d) => d.date === day.date);
  const target = all.slice(idx + 1).find((d) => d.type !== 'mock' && d.type !== 'exam');
  if (!target) return res.status(400).json({ error: '後面沒有可承接的訓練日了' });

  const moved: string[] = [];
  const tx = db.transaction(() => {
    const items = buildItems(day);
    // E/MAIN 未完成 → 建立順延卡
    const mainItem = items.find((i) => i.key === 'E' || i.key === 'MAIN');
    if (mainItem && !mainItem.done && day.main) {
      db.prepare(
        'INSERT INTO carryover (from_date, to_date, content, created_at) VALUES (?,?,?,?)'
      ).run(day.date, target.date, `[${day.date} 順延] ${day.main}`, nowIso());
      moved.push('主科練習');
    }
    // 未完成影片 → 改排定日期
    const codes = JSON.parse(day.videos) as string[];
    for (const code of codes) {
      const v = db.prepare('SELECT done FROM videos WHERE code = ?').get(code) as
        | { done: number }
        | undefined;
      if (v && v.done === 0) {
        db.prepare('UPDATE videos SET scheduled_date = ? WHERE code = ?').run(target.date, code);
        moved.push(`影片 ${code}`);
      }
    }
    db.prepare('UPDATE plan_days SET missed = 1 WHERE date = ?').run(day.date);
  });
  tx();

  res.json({ ok: true, target: target.date, moved });
});
