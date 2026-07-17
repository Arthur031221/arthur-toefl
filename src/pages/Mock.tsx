import { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { Card, EmptyState, PageTitle, Spinner, useToast } from '../components/ui';

interface ExamRow {
  id: number;
  date: string;
  label: string;
  r: number | null;
  l: number | null;
  w: number | null;
  s: number | null;
  self_ws: number;
  note: string;
  total: number | null;
}

interface MockData {
  planned: { date: string; label: string }[];
  exams: ExamRow[];
  decision: { total: number; verdict: string; detail: string } | null;
}

interface WeekRow {
  week_start: string;
  label: string;
  isCurrent: boolean;
  isPast: boolean;
  saved: {
    ctw_acc: number | null;
    ann_acc: number | null;
    selfcheck_catches: number | null;
    deadair_avg: number | null;
    next_week: string;
  } | null;
  autofill: {
    deadairAvg: number | null;
    speakingCount: number;
    writingCount: number;
    writingAvgScore: number | null;
    errorsNew: number;
    dictationAcc: number | null;
    dictationCount: number;
    ctwAcc: number | null;
    ctwCount: number;
    annAcc: number | null;
    annCount: number;
  };
}

export default function Mock() {
  const [tab, setTab] = useState<'mock' | 'review'>('mock');
  return (
    <div>
      <PageTitle title="模考與週回顧" sub="8/2、8/23、8/30、9/13 四場+正式考·每週日回顧四指標" />
      <div className="mb-4 flex gap-2">
        <button className={tab === 'mock' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('mock')}>
          模考成績
        </button>
        <button className={tab === 'review' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('review')}>
          每週日回顧
        </button>
      </div>
      {tab === 'mock' ? <MockTab /> : <ReviewTab />}
    </div>
  );
}

/* ================= 模考成績 ================= */

function MockTab() {
  const [data, setData] = useState<MockData | null>(null);
  const [form, setForm] = useState({ date: '2026-08-02', label: 'ETS Sample Test 1', r: '', l: '', w: '', s: '', self_ws: true, note: '' });
  const [toast, showToast] = useToast();

  const load = useCallback(async () => setData(await api.get<MockData>('/api/mock')), []);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    try {
      await api.post('/api/mock', {
        date: form.date,
        label: form.label,
        r: num(form.r),
        l: num(form.l),
        w: num(form.w),
        s: num(form.s),
        self_ws: form.self_ws,
        note: form.note,
      });
      showToast('成績已登記');
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  if (!data) return <Spinner />;

  const chartData = data.exams
    .filter((e) => e.total !== null || e.r !== null)
    .map((e) => ({
      name: `${e.date.slice(5)} ${e.label.slice(0, 8)}`,
      R: e.r,
      L: e.l,
      W: e.w,
      S: e.s,
      總分: e.total,
    }));

  return (
    <div className="space-y-4">
      {toast}
      {data.decision && (
        <div
          className={`card border-2 ${
            data.decision.verdict === '照計畫走'
              ? 'border-emerald-400 bg-emerald-50'
              : data.decision.verdict === '臨界區間'
                ? 'border-amber-400 bg-amber-50'
                : 'border-rose-400 bg-rose-50'
          }`}
        >
          <div className="font-bold text-slate-800">
            8/30 TPO 決策:{data.decision.verdict}(總分 {data.decision.total})
          </div>
          <div className="text-sm text-slate-600 mt-1">{data.decision.detail}</div>
        </div>
      )}

      <Card title="四科趨勢(紅虛線=4.5 目標·綠虛線=5.0)">
        {chartData.length === 0 ? (
          <EmptyState text="還沒有成績。第一場模考:8/2 ETS Sample Test 1" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 6]} tick={{ fontSize: 11 }} tickCount={7} />
              <Tooltip />
              <Legend />
              <ReferenceLine y={4.5} stroke="#f43f5e" strokeDasharray="4 4" />
              <ReferenceLine y={5.0} stroke="#10b981" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="R" stroke="#0ea5e9" strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="L" stroke="#8b5cf6" strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="W" stroke="#f59e0b" strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="S" stroke="#ef4444" strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="總分" stroke="#0f172a" strokeWidth={3} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="登記成績(新制 1–6 級分,可 0.5)">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <div className="label mb-1">場次</div>
            <select
              className="input w-full"
              value={`${form.date}|${form.label}`}
              onChange={(e) => {
                const [date, label] = e.target.value.split('|');
                setForm({ ...form, date, label });
              }}
            >
              {data.planned.map((p) => (
                <option key={p.date} value={`${p.date}|${p.label}`}>
                  {p.date.slice(5)} {p.label}
                </option>
              ))}
              <option value={`${form.date}|自訂場次`}>自訂場次...</option>
            </select>
          </div>
          {(['r', 'l', 'w', 's'] as const).map((k) => (
            <div key={k} className="col-span-1">
              <div className="label mb-1">{k.toUpperCase()}</div>
              <input
                className="input w-full"
                type="number"
                min={0}
                max={6}
                step={0.5}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </div>
          ))}
          <div className="col-span-3">
            <div className="label mb-1">備註</div>
            <input className="input w-full" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <label className="col-span-1 flex items-center gap-1 text-xs text-slate-500 pb-2">
            <input
              type="checkbox"
              checked={form.self_ws}
              onChange={(e) => setForm({ ...form, self_ws: e.target.checked })}
              className="h-4 w-4 rounded"
            />
            W/S 自評
          </label>
          <button className="btn-primary col-span-1" onClick={save}>
            登記
          </button>
        </div>
        <div className="mt-1 text-xs text-slate-400">ETS Sample Test 只給 R/L 分數;W/S 用 AI 批改分數自評即可,勾「W/S 自評」註記</div>
      </Card>

      <Card title="已登記">
        {data.exams.length === 0 ? (
          <EmptyState text="尚無紀錄" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-2">日期</th>
                <th className="py-2 pr-2">場次</th>
                <th className="py-2 pr-2">R</th>
                <th className="py-2 pr-2">L</th>
                <th className="py-2 pr-2">W</th>
                <th className="py-2 pr-2">S</th>
                <th className="py-2 pr-2">總分</th>
                <th className="py-2 pr-2">備註</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.exams.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-2">{e.date.slice(5)}</td>
                  <td className="py-2 pr-2">{e.label}{e.self_ws === 1 && <span className="text-xs text-slate-400">(W/S自評)</span>}</td>
                  <td className="py-2 pr-2">{e.r ?? '—'}</td>
                  <td className="py-2 pr-2">{e.l ?? '—'}</td>
                  <td className="py-2 pr-2">{e.w ?? '—'}</td>
                  <td className="py-2 pr-2">{e.s ?? '—'}</td>
                  <td className="py-2 pr-2 font-bold">{e.total ?? '—'}</td>
                  <td className="py-2 pr-2 text-xs text-slate-500">{e.note}</td>
                  <td className="py-2 text-right">
                    <button
                      className="btn-ghost text-xs text-rose-500"
                      onClick={async () => {
                        if (confirm('刪除這筆成績?')) {
                          await api.del(`/api/mock/${e.id}`);
                          load();
                        }
                      }}
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ================= 每週日回顧 ================= */

function ReviewTab() {
  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ctw_acc: '', ann_acc: '', selfcheck_catches: '', deadair_avg: '', next_week: '' });
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    const r = await api.get<{ weeks: WeekRow[] }>('/api/review');
    setWeeks(r.weeks);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function startEdit(w: WeekRow) {
    setEditing(w.week_start);
    setForm({
      ctw_acc: w.saved?.ctw_acc?.toString() ?? w.autofill.ctwAcc?.toString() ?? '',
      ann_acc: w.saved?.ann_acc?.toString() ?? w.autofill.annAcc?.toString() ?? '',
      selfcheck_catches: w.saved?.selfcheck_catches?.toString() ?? '',
      deadair_avg: w.saved?.deadair_avg?.toString() ?? w.autofill.deadairAvg?.toString() ?? '',
      next_week: w.saved?.next_week ?? '',
    });
  }

  async function save(weekStart: string) {
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    await api.put('/api/review', {
      week_start: weekStart,
      ctw_acc: num(form.ctw_acc),
      ann_acc: num(form.ann_acc),
      selfcheck_catches: num(form.selfcheck_catches),
      deadair_avg: num(form.deadair_avg),
      next_week: form.next_week,
    });
    showToast('回顧已儲存');
    setEditing(null);
    load();
  }

  if (!weeks) return <Spinner />;

  const chartData = weeks
    .filter((w) => w.saved)
    .map((w) => ({
      week: w.label.split('(')[0],
      CTW正確率: w.saved!.ctw_acc,
      Announcement正確率: w.saved!.ann_acc,
      自檢抓錯數: w.saved!.selfcheck_catches,
      死寂平均: w.saved!.deadair_avg,
    }));

  return (
    <div className="space-y-4">
      {toast}
      <Card title="四指標趨勢">
        {chartData.length === 0 ? (
          <EmptyState text="還沒有已儲存的週回顧。每週日填一次,四指標就會畫在這裡" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="CTW正確率" stroke="#0ea5e9" strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="Announcement正確率" stroke="#8b5cf6" strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="自檢抓錯數" stroke="#f59e0b" strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="死寂平均" stroke="#ef4444" strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="space-y-3">
        {weeks.map((w) => (
          <Card
            key={w.week_start}
            title={
              <span>
                {w.label}
                {w.isCurrent && <span className="ml-2 badge bg-brand-100 text-brand-700">本週</span>}
                {w.saved && <span className="ml-2 badge bg-emerald-100 text-emerald-700">已填 ✓</span>}
              </span>
            }
            right={
              editing !== w.week_start ? (
                <button className="btn-secondary" onClick={() => startEdit(w)}>
                  {w.saved ? '編輯' : '填回顧'}
                </button>
              ) : undefined
            }
          >
            <div className="text-xs text-slate-500 mb-2">
              本週平台資料:口說 {w.autofill.speakingCount} 次(死寂平均 {w.autofill.deadairAvg ?? '—'})·寫作{' '}
              {w.autofill.writingCount} 篇(平均 {w.autofill.writingAvgScore ?? '—'} 分)·聽寫{' '}
              {w.autofill.dictationCount} 次(正確率 {w.autofill.dictationAcc ?? '—'}%)·CTW{' '}
              {w.autofill.ctwCount} 次({w.autofill.ctwAcc ?? '—'}%)·Announcement {w.autofill.annCount} 次(
              {w.autofill.annAcc ?? '—'}%)·錯誤本新增 {w.autofill.errorsNew} 筆
            </div>
            {editing === w.week_start ? (
              <div className="grid grid-cols-10 gap-2 items-end">
                {(
                  [
                    ['ctw_acc', 'CTW 正確率%'],
                    ['ann_acc', 'Announcement 正確率%'],
                    ['selfcheck_catches', '寫作自檢抓錯數'],
                    ['deadair_avg', '口說死寂平均(自動帶入)'],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} className="col-span-2">
                    <div className="label mb-1">{label}</div>
                    <input
                      className="input w-full"
                      type="number"
                      value={form[k]}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="col-span-10">
                  <div className="label mb-1">下週弱科日排什麼?(文字)</div>
                  <textarea
                    className="input w-full"
                    rows={2}
                    value={form.next_week}
                    onChange={(e) => setForm({ ...form, next_week: e.target.value })}
                    placeholder="例:錯誤本「時態/三單」正字最多 → 週五弱科日全打時態專項"
                  />
                </div>
                <div className="col-span-10 flex gap-2">
                  <button className="btn-primary" onClick={() => save(w.week_start)}>
                    儲存
                  </button>
                  <button className="btn-secondary" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : w.saved ? (
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="badge bg-sky-100 text-sky-700">CTW {w.saved.ctw_acc ?? '—'}%</span>
                <span className="badge bg-violet-100 text-violet-700">Announcement {w.saved.ann_acc ?? '—'}%</span>
                <span className="badge bg-amber-100 text-amber-700">自檢抓錯 {w.saved.selfcheck_catches ?? '—'}</span>
                <span className="badge bg-rose-100 text-rose-700">死寂平均 {w.saved.deadair_avg ?? '—'}</span>
                {w.saved.next_week && <div className="w-full text-slate-600 text-xs mt-1">下週計畫:{w.saved.next_week}</div>}
              </div>
            ) : (
              <div className="text-xs text-slate-400">尚未填寫</div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
