import { Router } from 'express';
import { db } from '../db.ts';
import { todayStr, nowIso, isValidDate } from '../util.ts';

export const resourcesRouter = Router();

/** 影片清單 + 四條完課進度 */
resourcesRouter.get('/videos', (_req, res) => {
  const videos = db.prepare('SELECT * FROM videos ORDER BY code').all() as {
    course: string;
    done: number;
  }[];
  const courses = new Map<string, { course: string; total: number; done: number; done_target: string; speed: string }>();
  for (const v of videos as any[]) {
    const c = courses.get(v.course) ?? {
      course: v.course,
      total: 0,
      done: 0,
      done_target: v.done_target,
      speed: v.speed,
    };
    c.total++;
    if (v.done) c.done++;
    courses.set(v.course, c);
  }
  res.json({ videos, progress: [...courses.values()] });
});

/** 影片:填筆記/勾完成(不填筆記不能勾完成) */
resourcesRouter.patch('/videos/:code', (req, res) => {
  const { tips, done } = req.body as { tips?: string; done?: boolean };
  const video = db.prepare('SELECT * FROM videos WHERE code = ?').get(req.params.code) as
    | { code: string; tips: string; done: number }
    | undefined;
  if (!video) return res.status(404).json({ error: '找不到影片' });

  const newTips = typeof tips === 'string' ? tips : video.tips;
  if (done === true && newTips.trim().length === 0) {
    return res.status(400).json({ error: '請先填「3 個技巧」筆記,才能勾完成' });
  }
  const newDone = typeof done === 'boolean' ? (done ? 1 : 0) : video.done;
  const prev = db.prepare('SELECT done_at FROM videos WHERE code = ?').get(video.code) as {
    done_at: string;
  };
  const doneAt = newDone ? (video.done ? prev.done_at : nowIso()) : '';
  db.prepare('UPDATE videos SET tips = ?, done = ?, done_at = ? WHERE code = ?').run(
    newTips,
    newDone,
    doneAt,
    video.code
  );
  const updated = db.prepare('SELECT * FROM videos WHERE code = ?').get(video.code);
  res.json({ ok: true, video: updated });
});

/** Flex 配額總覽 */
resourcesRouter.get('/quota', (_req, res) => {
  const rows = db.prepare('SELECT * FROM quota').all() as {
    item: string;
    total: number;
    used: number;
    reserve: number;
    rule: string;
    planned: string;
  }[];
  const today = todayStr();
  res.json(
    rows.map((r) => {
      const planned = JSON.parse(r.planned) as string[];
      const nextPlanned = planned.find((p) => p >= today) ?? '';
      const remaining = r.total - r.used;
      return {
        ...r,
        planned,
        nextPlanned,
        remaining,
        lowWarning: remaining <= r.reserve,
      };
    })
  );
});

/** 我做了一題(扣減配額) */
resourcesRouter.post('/quota/:item/use', (req, res) => {
  const item = req.params.item;
  const { note, undo } = req.body as { note?: string; undo?: boolean };
  const q = db.prepare('SELECT * FROM quota WHERE item = ?').get(item) as
    | { item: string; total: number; used: number; reserve: number }
    | undefined;
  if (!q) return res.status(404).json({ error: '找不到此題型' });

  if (undo) {
    if (q.used <= 0) return res.status(400).json({ error: '已經是 0,無法回復' });
    db.prepare('UPDATE quota SET used = used - 1 WHERE item = ?').run(item);
    db.prepare('INSERT INTO quota_log (item, delta, date, note) VALUES (?,-1,?,?)').run(
      item,
      todayStr(),
      note ?? '回復誤按'
    );
  } else {
    if (q.used >= q.total) return res.status(400).json({ error: '配額已用完' });
    db.prepare('UPDATE quota SET used = used + 1 WHERE item = ?').run(item);
    db.prepare('INSERT INTO quota_log (item, delta, date, note) VALUES (?,1,?,?)').run(
      item,
      todayStr(),
      note ?? ''
    );
  }
  const updated = db.prepare('SELECT * FROM quota WHERE item = ?').get(item) as {
    total: number;
    used: number;
    reserve: number;
  };
  const remaining = updated.total - updated.used;
  res.json({
    ok: true,
    remaining,
    lowWarning: remaining <= updated.reserve,
    reserveNote:
      remaining <= updated.reserve ? `注意:已達保留線(保留 ${updated.reserve} 題)` : '',
  });
});

/** 配額使用紀錄 */
resourcesRouter.get('/quota/:item/log', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM quota_log WHERE item = ? ORDER BY id DESC LIMIT 50')
    .all(req.params.item);
  res.json(rows);
});

/** 外部資源連結牆 + 方法卡 */
resourcesRouter.get('/links', (_req, res) => {
  res.json(db.prepare('SELECT * FROM links ORDER BY id').all());
});
resourcesRouter.get('/methods', (_req, res) => {
  res.json(db.prepare('SELECT * FROM methods ORDER BY id').all());
});
