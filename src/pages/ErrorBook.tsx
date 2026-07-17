import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { Card, EmptyState, PageTitle, Spinner, useToast } from '../components/ui';
import type { ErrorEntry } from '../types';

const CATS = ['單複數/冠詞', '時態/三單', '拼寫', '固定搭配'];
const CAT_COLOR: Record<string, string> = {
  '單複數/冠詞': 'bg-sky-100 text-sky-700',
  '時態/三單': 'bg-violet-100 text-violet-700',
  拼寫: 'bg-rose-100 text-rose-700',
  固定搭配: 'bg-amber-100 text-amber-700',
};

interface Stats {
  byCat: { cat: string; n: number; repeats: number | null }[];
  weeklyNew: number;
  weekStart: string;
  w8Warning: boolean;
  w8Active: boolean;
  weeklySeries: { week: string; n: number }[];
  total: number;
}

export default function ErrorBook() {
  const [rows, setRows] = useState<ErrorEntry[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState('all');
  const [readMode, setReadMode] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ cat: CATS[0], wrong: '', correct: '', note: '' });
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      api.get<ErrorEntry[]>(`/api/errors?cat=${encodeURIComponent(filter)}`),
      api.get<Stats>('/api/errors/stats'),
    ]);
    setRows(r);
    setStats(s);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!form.wrong.trim() || !form.correct.trim()) {
      showToast('錯誤原文與正確版必填', 'err');
      return;
    }
    await api.post('/api/errors', { ...form, source: '手動' });
    setForm({ cat: form.cat, wrong: '', correct: '', note: '' });
    setAdding(false);
    showToast('已加入錯誤本');
    load();
  }

  async function repeat(id: number) {
    await api.post(`/api/errors/${id}/repeat`);
    showToast('再犯 +1(這類是下週弱科日主角)');
    load();
  }

  async function remove(id: number) {
    if (!confirm('刪除這筆錯誤?')) return;
    await api.del(`/api/errors/${id}`);
    load();
  }

  if (!rows || !stats) return <Spinner />;

  if (readMode) return <ReadAloud rows={rows} onExit={() => setReadMode(false)} />;

  const chartData = stats.byCat.map((c) => ({ cat: c.cat, 筆數: c.n, 再犯: c.repeats ?? 0 }));

  return (
    <div>
      {toast}
      <PageTitle title="錯誤本" sub="四分類·正字計數(再犯最多的分類=下週弱科日主角)·考前用朗讀模式" />

      {/* 統計列 */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <div className="card text-center">
          <div className="text-3xl font-black text-slate-800">{stats.total}</div>
          <div className="text-xs text-slate-500">總筆數</div>
        </div>
        <div className={`card text-center ${stats.w8Warning ? 'border-rose-400 bg-rose-50' : ''}`}>
          <div className={`text-3xl font-black ${stats.w8Warning ? 'text-rose-600' : 'text-slate-800'}`}>
            {stats.weeklyNew}
          </div>
          <div className="text-xs text-slate-500">
            本週新增({stats.weekStart.slice(5)} 起)
            {stats.w8Active && <span className="block text-rose-500 font-medium">W8 紅線:單週 ≥5 警告</span>}
          </div>
        </div>
        <div className="card col-span-2">
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="cat" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="筆數" fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="再犯" fill="#f43f5e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {stats.w8Warning && (
        <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          ⚠️ 考前週警告:本週新增錯誤 ≥5 筆。優先複習錯誤本,暫停刷新題!
        </div>
      )}

      {/* 工具列 */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>
          全部
        </button>
        {CATS.map((c) => (
          <button key={c} className={filter === c ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter(c)}>
            {c}({stats.byCat.find((b) => b.cat === c)?.n ?? 0})
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setReadMode(true)} disabled={rows.length === 0}>
            🔊 朗讀模式
          </button>
          <button className="btn-primary" onClick={() => setAdding(!adding)}>
            + 新增錯誤
          </button>
        </div>
      </div>

      {adding && (
        <Card className="mb-3">
          <div className="grid grid-cols-12 gap-2">
            <select
              className="input col-span-2"
              value={form.cat}
              onChange={(e) => setForm({ ...form, cat: e.target.value })}
            >
              {CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              className="input col-span-3"
              placeholder="錯誤原文"
              value={form.wrong}
              onChange={(e) => setForm({ ...form, wrong: e.target.value })}
            />
            <input
              className="input col-span-3"
              placeholder="正確版"
              value={form.correct}
              onChange={(e) => setForm({ ...form, correct: e.target.value })}
            />
            <input
              className="input col-span-3"
              placeholder="備註(選填)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            <button className="btn-primary col-span-1" onClick={add}>
              存
            </button>
          </div>
        </Card>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState text="這個分類還沒有錯誤紀錄" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-2">分類</th>
                <th className="py-2 pr-2">錯誤原文</th>
                <th className="py-2 pr-2">正確版</th>
                <th className="py-2 pr-2">備註</th>
                <th className="py-2 pr-2">來源</th>
                <th className="py-2 pr-2">日期</th>
                <th className="py-2 pr-2">再犯</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-2">
                    <span className={`badge ${CAT_COLOR[r.cat] ?? 'bg-slate-100 text-slate-600'}`}>{r.cat}</span>
                  </td>
                  <td className="py-2 pr-2 text-rose-600">{r.wrong}</td>
                  <td className="py-2 pr-2 font-medium text-emerald-700">{r.correct}</td>
                  <td className="py-2 pr-2 text-xs text-slate-500">{r.note}</td>
                  <td className="py-2 pr-2 text-xs text-slate-400">{r.source}</td>
                  <td className="py-2 pr-2 text-xs text-slate-400">{r.created_at.slice(5, 10)}</td>
                  <td className="py-2 pr-2">
                    {r.repeat_count > 0 && (
                      <span className="badge bg-rose-100 text-rose-600">×{r.repeat_count}</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" title="同類錯誤再犯一次" onClick={() => repeat(r.id)}>
                      再犯+1
                    </button>
                    <button className="btn-ghost text-xs text-rose-500" onClick={() => remove(r.id)}>
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

/** 朗讀模式:全螢幕逐條翻卡(考前週用) */
function ReadAloud({ rows, onExit }: { rows: ErrorEntry[]; onExit: () => void }) {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const cur = rows[idx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setRevealed((r) => !r);
      }
      if (e.key === 'ArrowRight') {
        setIdx((i) => Math.min(rows.length - 1, i + 1));
        setRevealed(false);
      }
      if (e.key === 'ArrowLeft') {
        setIdx((i) => Math.max(0, i - 1));
        setRevealed(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows.length, onExit]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900 text-white">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="text-sm text-slate-400">
          朗讀模式 {idx + 1}/{rows.length}·空白鍵翻卡·←→ 切換·Esc 離開
        </div>
        <button className="btn bg-slate-700 text-white hover:bg-slate-600" onClick={onExit}>
          離開
        </button>
      </div>
      <button
        className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center"
        onClick={() => setRevealed(!revealed)}
      >
        <span className="badge bg-slate-700 text-slate-200">{cur.cat}</span>
        <div className="text-4xl font-bold text-rose-400 line-through decoration-2">{cur.wrong}</div>
        {revealed ? (
          <>
            <div className="text-5xl font-black text-emerald-400">{cur.correct}</div>
            {cur.note && <div className="text-lg text-slate-300">{cur.note}</div>}
          </>
        ) : (
          <div className="text-slate-500 text-lg">(點擊或按空白鍵顯示正確版,先唸出來!)</div>
        )}
      </button>
      <div className="flex justify-center gap-3 pb-8">
        <button
          className="btn bg-slate-700 text-white hover:bg-slate-600"
          disabled={idx === 0}
          onClick={() => {
            setIdx(idx - 1);
            setRevealed(false);
          }}
        >
          ← 上一條
        </button>
        <button
          className="btn bg-emerald-600 text-white hover:bg-emerald-500"
          disabled={idx === rows.length - 1}
          onClick={() => {
            setIdx(idx + 1);
            setRevealed(false);
          }}
        >
          下一條 →
        </button>
      </div>
    </div>
  );
}
