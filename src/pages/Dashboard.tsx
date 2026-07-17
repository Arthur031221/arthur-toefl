import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, ProgressBar, Spinner, useToast } from '../components/ui';
import type { DashboardData, TaskItem } from '../types';

const TYPE_CARD_STYLE: Record<string, string> = {
  study: '',
  mock: 'border-amber-400 bg-amber-50',
  rest: 'border-emerald-400 bg-emerald-50',
  travel: 'border-sky-400 bg-sky-50',
  exam: 'border-rose-400 bg-rose-50',
};

const TYPE_BADGE: Record<string, string> = {
  study: 'bg-slate-200 text-slate-700',
  mock: 'bg-amber-500 text-white',
  rest: 'bg-emerald-500 text-white',
  travel: 'bg-sky-500 text-white',
  exam: 'bg-rose-600 text-white',
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api.get<DashboardData>('/api/dashboard'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(item: TaskItem) {
    if (!data?.day) return;
    if (item.kind === 'video') {
      showToast('影片完成請到「資源與配額」填 3 個技巧筆記後勾選', 'err');
      return;
    }
    try {
      await api.post('/api/checks', { date: data.day.date, item: item.key, done: !item.done });
      await load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  async function toggleCarryover(id: number, done: boolean) {
    await api.patch(`/api/carryover/${id}`, { done });
    await load();
  }

  if (error) return <div className="card text-rose-600">載入失敗:{error}</div>;
  if (!data) return <Spinner />;

  const { day } = data;
  const subjects = ['R', 'L', 'W', 'S'] as const;
  const mockScore = (k: string) =>
    data.latestMock ? ((data.latestMock as unknown as Record<string, number | null>)[k.toLowerCase()] ?? null) : null;

  return (
    <div className="space-y-5">
      {toast}
      {/* 倒數 + streak */}
      <div className="flex items-stretch gap-4">
        <div className="card flex-1 flex items-center justify-between bg-slate-900 text-white border-slate-900">
          <div>
            <div className="text-sm text-slate-300">距離 9/19 考試還有</div>
            <div className="text-5xl font-black tracking-tight mt-1">
              {data.daysLeft} <span className="text-xl font-bold">天</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-300">今天</div>
            <div className="text-lg font-semibold">{data.today}</div>
            {day && (
              <span className={`badge mt-1 ${TYPE_BADGE[day.type] ?? ''}`}>{day.typeLabel}</span>
            )}
          </div>
        </div>
        <div className="card w-44 flex flex-col items-center justify-center">
          <div className="text-4xl font-black text-orange-500">🔥 {data.streak}</div>
          <div className="text-xs text-slate-500 mt-1">連續完成天數</div>
        </div>
      </div>

      {/* 今日任務卡 */}
      {day ? (
        <Card
          title={
            <span>
              今日任務
              <span className="ml-2 text-xs font-normal text-slate-400">
                {day.phase}·{day.dow}·完成 {day.stat.done}/{day.stat.total}
              </span>
            </span>
          }
          right={
            day.stat.complete ? (
              <span className="badge bg-emerald-100 text-emerald-700">今日全部完成 ✓</span>
            ) : undefined
          }
          className={TYPE_CARD_STYLE[day.type] ?? ''}
        >
          {day.special && (
            <div className="mb-3 rounded-lg bg-amber-100 border border-amber-300 px-3 py-2 text-sm text-amber-800">
              ⭐ 特別事項:{day.special}
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {day.items.map((item) => (
              <li key={item.key} className="flex items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggle(item)}
                  disabled={item.kind === 'video'}
                  title={item.kind === 'video' ? '請到資源與配額頁填筆記後勾選' : ''}
                  className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-60"
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-medium ${item.done ? 'line-through text-slate-400' : 'text-slate-800'}`}
                  >
                    {item.label}
                    {item.minutes && (
                      <span className="ml-1.5 badge bg-slate-100 text-slate-500">{item.minutes} 分</span>
                    )}
                  </div>
                  {item.sub && <div className="text-xs text-slate-500 truncate">{item.sub}</div>}
                </div>
                {item.module && (
                  <Link to={item.module} className="btn-ghost shrink-0">
                    前往 →
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {data.carryover.length > 0 && (
            <div className="mt-3 rounded-lg bg-orange-50 border border-orange-200 p-3">
              <div className="text-xs font-semibold text-orange-700 mb-1.5">昨日順延任務</div>
              {data.carryover.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={c.done === 1}
                    onChange={(e) => toggleCarryover(c.id, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <span className={c.done ? 'line-through text-slate-400' : ''}>{c.content}</span>
                </label>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card title="今日任務">
          <div className="py-6 text-center text-slate-500 text-sm">
            {data.today < data.planStart ? (
              <>
                65 天計畫從 <b>{data.planStart}</b> 開始,明天見!
                <br />
                可以先到「65 天日曆」預覽整體安排。
              </>
            ) : (
              <>今天({data.today})不在計畫範圍內。計畫區間:{data.planStart} ~ {data.planEnd}</>
            )}
          </div>
        </Card>
      )}

      {/* 四科目標 + 最近模考 */}
      <Card
        title="四科目標"
        right={
          data.latestMock ? (
            <span className="text-xs text-slate-500">
              最近模考:{data.latestMock.label}({data.latestMock.date})
            </span>
          ) : (
            <Link to="/mock" className="text-xs text-brand-600 hover:underline">
              尚無模考成績,前往登記 →
            </Link>
          )
        }
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
          {subjects.map((s) => {
            const t = data.targets[s];
            const cur = mockScore(s);
            const pct = Math.min(100, Math.max(0, (((cur ?? t.from) - 0) / 6) * 100));
            return (
              <div key={s}>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span className="font-bold text-slate-700">{s}</span>
                  <span>
                    {t.from} → <b className="text-brand-600">{t.to}</b>
                    {cur !== null && <span className="ml-1 text-emerald-600">現 {cur}</span>}
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-200 relative overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                  <div
                    className="absolute top-0 h-full w-0.5 bg-rose-500"
                    style={{ left: `${(t.to / 6) * 100}%` }}
                    title={`目標 ${t.to}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {data.day === null && data.today >= data.planStart && (
        <div className="text-xs text-slate-400 text-center">找不到今天的計畫?請確認系統日期。</div>
      )}
    </div>
  );
}
