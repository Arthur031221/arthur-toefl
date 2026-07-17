import { db } from './db.ts';

export interface PlanDay {
  date: string;
  dow: string;
  phase: string;
  type: string; // study | mock | rest | travel | exam
  videos: string; // JSON string
  main: string;
  special: string;
  missed: number;
}

export interface VideoRow {
  code: string;
  course: string;
  title: string;
  dur: string;
  speed: string;
  done: number;
  tips: string;
  scheduled_date: string;
  done_target: string;
  note: string;
  done_at: string;
}

export interface TaskItem {
  key: string;
  kind: 'check' | 'video';
  label: string;
  sub: string;
  minutes: number | null;
  module: string;
  done: boolean;
  code?: string;
}

export const MILESTONES = ['2026-08-02', '2026-08-23', '2026-08-30', '2026-09-13', '2026-09-19'];

export function getPlanDay(date: string): PlanDay | undefined {
  return db.prepare('SELECT * FROM plan_days WHERE date = ?').get(date) as PlanDay | undefined;
}

export function getAllPlanDays(): PlanDay[] {
  return db.prepare('SELECT * FROM plan_days ORDER BY date').all() as PlanDay[];
}

function getChecks(date: string): Set<string> {
  const rows = db
    .prepare('SELECT item FROM daily_checks WHERE date = ? AND done = 1')
    .all(date) as { item: string }[];
  return new Set(rows.map((r) => r.item));
}

/** 以排定日期取當日影片(順延後會跟著移動) */
export function getVideosForDate(date: string): VideoRow[] {
  return db
    .prepare('SELECT * FROM videos WHERE scheduled_date = ? ORDER BY code')
    .all(date) as VideoRow[];
}

/** 從主科練習文字猜測對應模組 */
export function guessModule(main: string): string {
  if (/Email|Discussion|urbanization|^W:|寫作/i.test(main)) return '/writing';
  if (/Interview|口說|L&R|narration|^S:/i.test(main)) return '/speaking';
  if (/聽寫|^L:|Announcement|Conversation|Academic Talk/i.test(main)) return '/dictation';
  if (/錯誤本/.test(main)) return '/errors';
  if (/模考|TPO|Sample Test|全真/.test(main)) return '/mock';
  if (/拼寫/.test(main)) return '/spelling';
  if (/^R:|Daily Life|CTW|Academic Passage/i.test(main)) return '/resources';
  if (/Flex/i.test(main)) return '/resources';
  return '';
}

const TYPE_LABEL: Record<string, string> = {
  study: '一般訓練日',
  mock: '模考日',
  rest: '休息/輕量日',
  travel: '飛行日',
  exam: '考試日',
};

export function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t;
}

/** 產生某日的任務清單(Dashboard 任務卡與日曆展開共用) */
export function buildItems(day: PlanDay): TaskItem[] {
  const checks = getChecks(day.date);
  const videos = getVideosForDate(day.date);
  const items: TaskItem[] = [];

  if (day.type === 'study') {
    items.push(
      { key: 'A', kind: 'check', label: 'A|口說鐵律', sub: 'Interview 錄音+跟讀', minutes: 30, module: '/speaking', done: checks.has('A') },
      { key: 'B', kind: 'check', label: 'B|聽寫', sub: '1–2 句循環逐字寫', minutes: 20, module: '/dictation', done: checks.has('B') },
      { key: 'C', kind: 'check', label: 'C|拼寫', sub: '個人錯字+學術高頻', minutes: 15, module: '/spelling', done: checks.has('C') }
    );
  }

  for (const v of videos) {
    items.push({
      key: `V:${v.code}`,
      kind: 'video',
      label: `D|${v.code} ${v.title}`,
      sub: `${v.dur}·建議 ${v.speed}${v.note ? '·' + v.note : ''}`,
      minutes: null,
      module: '/resources',
      done: v.done === 1,
      code: v.code,
    });
  }

  if (day.type === 'study') {
    items.push(
      { key: 'E', kind: 'check', label: `E|主科練習`, sub: day.main, minutes: null, module: guessModule(day.main), done: checks.has('E') },
      { key: 'F', kind: 'check', label: 'F|檢討收尾', sub: '錯誤本更新+筆記', minutes: null, module: '/errors', done: checks.has('F') }
    );
  } else {
    items.push({
      key: 'MAIN',
      kind: 'check',
      label: `${typeLabel(day.type)}安排`,
      sub: day.main,
      minutes: null,
      module: guessModule(day.main),
      done: checks.has('MAIN'),
    });
  }

  return items;
}

export interface DayStat {
  total: number;
  done: number;
  complete: boolean;
}

export function dayStat(day: PlanDay): DayStat {
  const items = buildItems(day);
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return { total, done, complete: total > 0 && done === total };
}

/** 連續完成天數:從 today(或昨天)往回數 */
export function calcStreak(today: string): number {
  const days = getAllPlanDays();
  if (days.length === 0) return 0;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days[0].date;

  let cursor = today;
  const todayDay = byDate.get(today);
  let streak = 0;
  // 今天還沒全完成不扣分,從昨天開始數
  if (!todayDay || !dayStat(todayDay).complete) {
    cursor = prevDate(cursor);
  }
  while (cursor >= first) {
    const d = byDate.get(cursor);
    if (!d) break;
    if (!dayStat(d).complete) break;
    streak++;
    cursor = prevDate(cursor);
  }
  return streak;
}

function prevDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(
    t.getUTCDate()
  ).padStart(2, '0')}`;
}
