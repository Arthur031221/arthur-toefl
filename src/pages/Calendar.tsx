import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Card, PageTitle, Spinner, useToast } from '../components/ui';
import type { Carryover, PlanDay, TaskItem } from '../types';

interface PlanResponse {
  today: string;
  milestones: string[];
  days: PlanDay[];
}

interface DayDetail extends PlanDay {
  items: TaskItem[];
  carryover: Carryover[];
}

const TYPE_DOT: Record<string, string> = {
  study: 'bg-slate-300',
  mock: 'bg-amber-500',
  rest: 'bg-emerald-400',
  travel: 'bg-sky-400',
  exam: 'bg-rose-600',
};

export default function Calendar() {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setData(await api.get<PlanResponse>('/api/plan'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    api.get<DayDetail>(`/api/plan/${selected}`).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  const months = useMemo(() => {
    if (!data) return [];
    const byMonth = new Map<string, PlanDay[]>();
    for (const d of data.days) {
      const m = d.date.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(d);
    }
    return [...byMonth.entries()];
  }, [data]);

  async function toggleItem(day: DayDetail, item: TaskItem) {
    if (item.kind === 'video') {
      showToast('影片完成請到「資源與配額」填筆記後勾選', 'err');
      return;
    }
    await api.post('/api/checks', { date: day.date, item: item.key, done: !item.done });
    setDetail(await api.get<DayDetail>(`/api/plan/${day.date}`));
    load();
  }

  async function postpone(date: string) {
    if (!confirm(`把 ${date} 未完成的關鍵任務(主科練習+影片)順延到下一個訓練日?`)) return;
    try {
      const r = await api.post<{ target: string; moved: string[] }>(`/api/plan/${date}/postpone`);
      showToast(
        r.moved.length > 0 ? `已順延到 ${r.target}:${r.moved.join('、')}` : '沒有未完成的關鍵任務'
      );
      setDetail(await api.get<DayDetail>(`/api/plan/${date}`));
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  if (!data) return <Spinner />;

  const milestoneSet = new Set(data.milestones);

  return (
    <div>
      {toast}
      <PageTitle title="65 天日曆" sub="7/16 → 9/19·點任一天展開任務;里程碑:8/2、8/23、8/30 模考,9/13 全真,9/19 考試" />

      <div className="mb-4 flex gap-2">
        <button
          className={view === 'month' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setView('month')}
        >
          月曆檢視
        </button>
        <button
          className={view === 'list' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setView('list')}
        >
          列表檢視
        </button>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          {Object.entries({ 一般: 'study', 模考: 'mock', 休息: 'rest', 飛行: 'travel', 考試: 'exam' }).map(
            ([label, t]) => (
              <span key={t} className="flex items-center gap-1">
                <span className={`h-2.5 w-2.5 rounded-full ${TYPE_DOT[t]}`} />
                {label}
              </span>
            )
          )}
        </div>
      </div>

      {view === 'month' ? (
        <div className="space-y-6">
          {months.map(([month, days]) => (
            <Card key={month} title={`${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`}>
              <div className="grid grid-cols-7 gap-1.5 text-center text-xs text-slate-400 mb-1.5">
                {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {/* 月初空格(週一起始) */}
                {Array.from({ length: mondayOffset(days[0].date) }).map((_, i) => (
                  <div key={`sp${i}`} />
                ))}
                {days.map((d) => {
                  const isMilestone = milestoneSet.has(d.date);
                  return (
                    <button
                      key={d.date}
                      onClick={() => setSelected(selected === d.date ? null : d.date)}
                      className={`relative rounded-lg border p-1.5 text-left min-h-[64px] transition-all hover:shadow ${
                        d.isToday
                          ? 'border-brand-600 ring-2 ring-brand-300'
                          : selected === d.date
                            ? 'border-brand-400'
                            : 'border-slate-200'
                      } ${d.stat.complete ? 'bg-emerald-50' : d.missed ? 'bg-orange-50' : 'bg-white'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${d.isToday ? 'text-brand-600' : 'text-slate-700'}`}>
                          {Number(d.date.slice(8))}
                        </span>
                        <span className={`h-2 w-2 rounded-full ${TYPE_DOT[d.type]}`} />
                      </div>
                      {isMilestone && <div className="text-[10px] text-amber-600 font-bold">★里程碑</div>}
                      <div className="text-[10px] text-slate-500 truncate">{d.phase}</div>
                      {d.isPast || d.isToday ? (
                        <div
                          className={`text-[10px] font-medium ${
                            d.stat.complete ? 'text-emerald-600' : 'text-slate-400'
                          }`}
                        >
                          {d.stat.done}/{d.stat.total}
                          {d.stat.complete && ' ✓'}
                        </div>
                      ) : null}
                      {d.carryoverIn ? (
                        <div className="text-[10px] text-orange-500">+{d.carryoverIn} 順延</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {data.days.map((d) => (
              <li key={d.date}>
                <button
                  className={`w-full flex items-center gap-3 py-2.5 px-1 text-left hover:bg-slate-50 rounded ${
                    d.isToday ? 'bg-brand-50' : ''
                  }`}
                  onClick={() => setSelected(selected === d.date ? null : d.date)}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_DOT[d.type]}`} />
                  <span className="w-28 shrink-0 text-sm font-medium text-slate-700">
                    {d.date.slice(5)}({d.dow})
                  </span>
                  <span className="w-12 shrink-0 text-xs text-slate-400">{d.phase}</span>
                  <span className="flex-1 truncate text-sm text-slate-600">{d.main}</span>
                  {milestoneSet.has(d.date) && <span className="text-amber-500">★</span>}
                  {(d.isPast || d.isToday) && (
                    <span
                      className={`badge ${
                        d.stat.complete ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {d.stat.done}/{d.stat.total}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 展開的單日詳情 */}
      {detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelected(null)}>
          <div className="card max-h-[85vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-lg font-bold">
                  {detail.date}(週{detail.dow})
                  <span className="ml-2 badge bg-slate-100 text-slate-600">{detail.typeLabel}</span>
                  {detail.missed === 1 && <span className="ml-1 badge bg-orange-100 text-orange-600">已順延</span>}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {detail.phase}·完成 {detail.stat.done}/{detail.stat.total}
                </div>
              </div>
              <button className="btn-secondary" onClick={() => setSelected(null)}>
                關閉
              </button>
            </div>
            {detail.special && (
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                ⭐ {detail.special}
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {detail.items.map((item) => (
                <li key={item.key} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={item.kind === 'video'}
                    onChange={() => toggleItem(detail, item)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 disabled:opacity-60"
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${item.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {item.label}
                    </div>
                    {item.sub && <div className="text-xs text-slate-400 truncate">{item.sub}</div>}
                  </div>
                </li>
              ))}
            </ul>
            {detail.carryover.length > 0 && (
              <div className="mt-2 text-xs text-orange-600">
                本日承接 {detail.carryover.length} 項順延任務(見 Dashboard)
              </div>
            )}
            {detail.type !== 'mock' && detail.type !== 'exam' && detail.missed === 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <button className="btn-secondary" onClick={() => postpone(detail.date)}>
                  標為沒做到,關鍵任務順延到隔天 →
                </button>
                <div className="mt-1 text-[11px] text-slate-400">僅順延主科練習與未完成影片;模考不可順延</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 該日期在週一起始格線中的偏移 */
function mondayOffset(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}
