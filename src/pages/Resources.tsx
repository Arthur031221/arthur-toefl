import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Card, PageTitle, ProgressBar, Spinner, useToast } from '../components/ui';
import type { CourseProgress, QuotaItem, VideoRow } from '../types';

interface VideosResponse {
  videos: VideoRow[];
  progress: CourseProgress[];
}
interface LinkRow {
  id: number;
  name: string;
  url: string;
  whenuse: string;
}
interface MethodRow {
  id: number;
  title: string;
  body: string;
}

const COURSE_COLOR: Record<string, string> = {
  '聽力(Sophie洪)': 'bg-sky-500',
  '口說(Sophie洪)': 'bg-rose-500',
  '閱讀(Alex朱)': 'bg-emerald-500',
  '寫作(Alex朱)': 'bg-violet-500',
};

export default function Resources() {
  const [tab, setTab] = useState<'quota' | 'videos' | 'links'>('quota');
  return (
    <div>
      <PageTitle title="資源與配額中心" sub="Flex 稀缺題配額·TKB 66 部影片進度·外部資源連結牆" />
      <div className="mb-4 flex gap-2">
        {(
          [
            ['quota', 'Flex 配額'],
            ['videos', 'TKB 影片(66)'],
            ['links', '連結牆+方法卡'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'quota' && <QuotaTab />}
      {tab === 'videos' && <VideosTab />}
      {tab === 'links' && <LinksTab />}
    </div>
  );
}

function QuotaTab() {
  const [rows, setRows] = useState<QuotaItem[] | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => setRows(await api.get<QuotaItem[]>('/api/quota')), []);
  useEffect(() => {
    load();
  }, [load]);

  async function useOne(item: QuotaItem, undo = false) {
    if (!undo && item.remaining - 1 <= item.reserve && item.reserve > 0) {
      if (!confirm(`「${item.item}」扣掉這題後只剩 ${item.remaining - 1} 題(保留線 ${item.reserve})。確定要用嗎?`))
        return;
    }
    try {
      const r = await api.post<{ remaining: number; reserveNote: string }>(
        `/api/quota/${encodeURIComponent(item.item)}/use`,
        { undo }
      );
      showToast(undo ? '已回復 1 題' : `已扣減,剩 ${r.remaining} 題。${r.reserveNote}`, r.reserveNote && !undo ? 'err' : 'ok');
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  if (!rows) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {toast}
      {rows.map((q) => (
        <div key={q.item} className={`card ${q.lowWarning ? 'border-rose-300 bg-rose-50' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="font-semibold text-slate-800">{q.item}</div>
            <div className={`text-lg font-black ${q.lowWarning ? 'text-rose-600' : 'text-brand-600'}`}>
              {q.remaining}
              <span className="text-xs font-normal text-slate-400">/{q.total}</span>
            </div>
          </div>
          <div className="mt-2">
            <ProgressBar value={q.used} max={q.total} color={q.lowWarning ? 'bg-rose-500' : 'bg-brand-500'} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              {q.rule && <span>{q.rule}</span>}
              {q.reserve > 0 && <span className="ml-1 text-rose-500">(永遠保留 {q.reserve} 題)</span>}
            </span>
            {q.nextPlanned && <span>下次計畫:{q.nextPlanned.slice(5)}</span>}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={() => useOne(q)} disabled={q.remaining <= 0}>
              我做了一題 −1
            </button>
            <button className="btn-secondary" onClick={() => useOne(q, true)} disabled={q.used <= 0}>
              回復
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function VideosTab() {
  const [data, setData] = useState<VideosResponse | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tips, setTips] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [toast, showToast] = useToast();

  const load = useCallback(async () => setData(await api.get<VideosResponse>('/api/videos')), []);
  useEffect(() => {
    load();
  }, [load]);

  const courses = useMemo(() => (data ? [...new Set(data.videos.map((v) => v.course))] : []), [data]);

  async function save(code: string, done: boolean) {
    try {
      await api.patch(`/api/videos/${code}`, { tips, done });
      showToast(done ? `${code} 已完成 ✓` : '筆記已儲存');
      setEditing(null);
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  async function uncheck(code: string) {
    await api.patch(`/api/videos/${code}`, { done: false });
    load();
  }

  if (!data) return <Spinner />;

  const shown = data.videos.filter((v) => filter === 'all' || v.course === filter);

  return (
    <div className="space-y-4">
      {toast}
      <Card title="四條完課進度">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.progress.map((p) => (
            <ProgressBar
              key={p.course}
              value={p.done}
              max={p.total}
              color={COURSE_COLOR[p.course] ?? 'bg-brand-500'}
              label={`${p.course}·目標 ${p.done_target.slice(5)}·${p.speed}`}
            />
          ))}
        </div>
      </Card>

      <div className="flex gap-2 flex-wrap">
        <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>
          全部(66)
        </button>
        {courses.map((c) => (
          <button key={c} className={filter === c ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-2">代碼</th>
              <th className="py-2 pr-2">片名</th>
              <th className="py-2 pr-2 whitespace-nowrap">時長</th>
              <th className="py-2 pr-2 whitespace-nowrap">倍速</th>
              <th className="py-2 pr-2 whitespace-nowrap">排定</th>
              <th className="py-2 pr-2">3 個技巧筆記</th>
              <th className="py-2 whitespace-nowrap">完成</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((v) => (
              <tr key={v.code} className={v.done ? 'bg-emerald-50/50' : ''}>
                <td className="py-2 pr-2 font-mono text-xs font-bold text-slate-700">{v.code}</td>
                <td className="py-2 pr-2">
                  {v.title}
                  {v.note && <div className="text-[11px] text-amber-600">{v.note}</div>}
                </td>
                <td className="py-2 pr-2 text-xs text-slate-500">{v.dur}</td>
                <td className="py-2 pr-2 text-xs text-slate-500 whitespace-nowrap">{v.speed}</td>
                <td className="py-2 pr-2 text-xs text-slate-500">{v.scheduled_date ? v.scheduled_date.slice(5) : '—'}</td>
                <td className="py-2 pr-2">
                  {editing === v.code ? (
                    <div className="flex gap-1.5 items-start">
                      <textarea
                        autoFocus
                        className="input w-full text-xs"
                        rows={2}
                        placeholder="看完寫下 3 個技巧(必填才能勾完成)"
                        value={tips}
                        onChange={(e) => setTips(e.target.value)}
                      />
                      <div className="flex flex-col gap-1">
                        <button className="btn-primary text-xs px-2" onClick={() => save(v.code, true)}>
                          存+完成
                        </button>
                        <button className="btn-secondary text-xs px-2" onClick={() => save(v.code, v.done === 1)}>
                          只存筆記
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="text-left text-xs text-slate-600 hover:text-brand-600 w-full"
                      title="點擊編輯筆記"
                      onClick={() => {
                        setEditing(v.code);
                        setTips(v.tips);
                      }}
                    >
                      {v.tips ? v.tips : <span className="text-slate-300">點擊填筆記...</span>}
                    </button>
                  )}
                </td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={v.done === 1}
                    onChange={(e) => {
                      if (e.target.checked) {
                        if (!v.tips.trim()) {
                          showToast('請先填「3 個技巧」筆記才能勾完成', 'err');
                          setEditing(v.code);
                          setTips(v.tips);
                        } else {
                          setTips(v.tips);
                          api.patch(`/api/videos/${v.code}`, { done: true }).then(load);
                        }
                      } else {
                        uncheck(v.code);
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function LinksTab() {
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [methods, setMethods] = useState<MethodRow[] | null>(null);

  useEffect(() => {
    api.get<LinkRow[]>('/api/links').then(setLinks);
    api.get<MethodRow[]>('/api/methods').then(setMethods);
  }, []);

  if (!links || !methods) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card title="外部資源連結牆">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {links.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 p-3 hover:border-brand-400 hover:shadow-sm transition-all"
            >
              <div className="font-medium text-slate-800 text-sm">{l.name} ↗</div>
              <div className="text-xs text-slate-500 mt-0.5">何時用:{l.whenuse}</div>
            </a>
          ))}
        </div>
      </Card>
      <Card title="方法卡(訓練 SOP)">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {methods.map((m) => (
            <div key={m.id} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div className="font-semibold text-sm text-slate-800 mb-1">{m.title}</div>
              <div className="text-xs leading-relaxed text-slate-600">{m.body}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
