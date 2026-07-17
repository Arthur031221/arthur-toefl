import { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { speakEn } from '../audio-utils';
import { Card, EmptyState, PageTitle, Spinner, useToast } from '../components/ui';
import type { SpellingWord } from '../types';

interface NextWord {
  id: number;
  grp: string;
  hint: string;
  first2: string;
  length: number;
  inRetryQueue: boolean;
  queueCount: number;
}

interface Stats {
  totals: { grp: string; total: number; mastered: number }[];
  queue: { word: string; retry_left: number }[];
  daily: { date: string; total: number; correct: number; acc: number }[];
}

export default function Spelling() {
  const [tab, setTab] = useState<'practice' | 'words'>('practice');
  return (
    <div>
      <PageTitle title="拼寫特訓" sub="個人錯字組+學術高頻組·答錯進今日重打 3 次佇列·答對 3 次降頻" />
      <div className="mb-4 flex gap-2">
        <button className={tab === 'practice' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('practice')}>
          練習
        </button>
        <button className={tab === 'words' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('words')}>
          詞庫管理
        </button>
      </div>
      {tab === 'practice' ? <Practice /> : <WordManager />}
    </div>
  );
}

function Practice() {
  const [mode, setMode] = useState<'zh' | 'letters'>('zh');
  const [grp, setGrp] = useState<'all' | 'personal' | 'academic'>('all');
  const [word, setWord] = useState<NextWord | null>(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<{ correct: boolean; word: string; hint: string } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessionCount, setSessionCount] = useState({ total: 0, correct: 0 });
  // 15 分鐘模式
  const [timedMode, setTimedMode] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(15 * 60);
  const inputRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();

  const loadStats = useCallback(async () => setStats(await api.get<Stats>('/api/spelling/stats')), []);

  const next = useCallback(
    async (excludeId?: number) => {
      try {
        const w = await api.get<NextWord>(`/api/spelling/next?grp=${grp}&exclude=${excludeId ?? 0}`);
        setWord(w);
        setAnswer('');
        setFeedback(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      } catch (e) {
        showToast((e as Error).message, 'err');
      }
    },
    [grp, showToast]
  );

  useEffect(() => {
    next();
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grp]);

  useEffect(() => {
    if (!timedMode) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setTimedMode(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [timedMode]);

  async function submit() {
    if (!word || feedback) return;
    if (!answer.trim()) return;
    const r = await api.post<{ correct: boolean; word: string; hint: string }>('/api/spelling/answer', {
      id: word.id,
      answer,
    });
    setFeedback(r);
    setSessionCount((c) => ({ total: c.total + 1, correct: c.correct + (r.correct ? 1 : 0) }));
    loadStats();
    if (r.correct) {
      setTimeout(() => next(word.id), 700);
    }
  }

  function speak(text: string) {
    speakEn(text, 0.9);
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const timesUp = timedMode === false && secondsLeft === 0;

  return (
    <div className="space-y-4">
      {toast}
      {/* 控制列 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1">
          {(
            [
              ['zh', '中文提示'],
              ['letters', '首 2 字母'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`rounded-md px-3 py-1 text-sm ${mode === k ? 'bg-white shadow font-medium' : 'text-slate-600'}`}
              onClick={() => setMode(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1">
          {(
            [
              ['all', '全部'],
              ['personal', '個人錯字'],
              ['academic', '學術高頻'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`rounded-md px-3 py-1 text-sm ${grp === k ? 'bg-white shadow font-medium' : 'text-slate-600'}`}
              onClick={() => setGrp(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={timedMode ? 'btn-danger' : 'btn-secondary'}
          onClick={() => {
            if (timedMode) {
              setTimedMode(false);
            } else {
              setSecondsLeft(15 * 60);
              setTimedMode(true);
              setSessionCount({ total: 0, correct: 0 });
              next();
            }
          }}
        >
          {timedMode ? `⏱ ${mm}:${ss}(點擊停止)` : '▶ 每日 15 分鐘模式'}
        </button>
        {word && word.queueCount > 0 && (
          <span className="badge bg-orange-100 text-orange-700">今日重打佇列:{word.queueCount} 字</span>
        )}
        <span className="ml-auto text-sm text-slate-500">
          本輪:{sessionCount.correct}/{sessionCount.total}
        </span>
      </div>

      {timesUp && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          🎉 15 分鐘完成!本輪 {sessionCount.total} 題,答對 {sessionCount.correct} 題(
          {sessionCount.total > 0 ? Math.round((sessionCount.correct / sessionCount.total) * 100) : 0}%)。記得到
          Dashboard 勾掉「C|拼寫」。
        </div>
      )}

      {/* 練習卡 */}
      {word && (
        <Card className={feedback ? (feedback.correct ? 'border-emerald-400' : 'border-rose-400') : ''}>
          <div className="py-6 text-center">
            <div className="mb-1 flex items-center justify-center gap-2">
              <span className="badge bg-slate-100 text-slate-500">
                {word.grp === 'personal' ? '個人錯字' : '學術高頻'}
              </span>
              {word.inRetryQueue && <span className="badge bg-orange-100 text-orange-600">重打佇列</span>}
            </div>
            <div className="text-3xl font-bold text-slate-800 my-4">
              {mode === 'zh' ? (
                word.hint || '(無中文提示,改用首字母模式吧)'
              ) : (
                <span className="font-mono tracking-wider">
                  {word.first2}
                  {'·'.repeat(Math.max(0, word.length - 2))}
                  <span className="ml-2 text-sm text-slate-400">({word.length} 字母)</span>
                </span>
              )}
            </div>
            {mode === 'zh' && (
              <div className="text-xs text-slate-400 mb-3">({word.length} 個字母)</div>
            )}
            <div className="flex justify-center gap-2">
              <input
                ref={inputRef}
                autoFocus
                className={`input w-72 text-center text-xl font-mono ${
                  feedback ? (feedback.correct ? 'border-emerald-500 bg-emerald-50' : 'border-rose-500 bg-rose-50') : ''
                }`}
                placeholder="輸入完整拼寫,Enter 送出"
                value={answer}
                readOnly={!!feedback && !feedback.correct}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (feedback && !feedback.correct) {
                      next(word.id);
                    } else {
                      submit();
                    }
                  }
                }}
              />
              <button className="btn-primary" onClick={() => (feedback && !feedback.correct ? next(word.id) : submit())}>
                {feedback && !feedback.correct ? '下一題' : '送出'}
              </button>
            </div>
            {feedback && (
              <div className={`mt-4 text-lg font-bold ${feedback.correct ? 'text-emerald-600' : 'text-rose-600'}`}>
                {feedback.correct ? (
                  '✓ 正確!'
                ) : (
                  <>
                    ✗ 正確拼寫:<span className="font-mono text-2xl ml-1">{feedback.word}</span>
                    <button className="btn-ghost ml-2 text-sm" onClick={() => speak(feedback.word)}>
                      🔊 唸給我聽
                    </button>
                    <div className="text-xs font-normal text-slate-500 mt-1">已加入今日重打 3 次佇列,按 Enter 繼續</div>
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 統計 */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <Card title="熟練度(答對 3 次=熟練)">
            {stats.totals.map((t) => (
              <div key={t.grp} className="mb-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{t.grp === 'personal' ? '個人錯字組' : '學術高頻組'}</span>
                  <span>
                    {t.mastered}/{t.total} 熟練
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${t.total > 0 ? (t.mastered / t.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
            {stats.queue.length > 0 && (
              <div className="mt-3 text-xs text-orange-600">
                今日待重打:{stats.queue.map((q) => `${q.word}(${q.retry_left})`).join('、')}
              </div>
            )}
          </Card>
          <Card title="近 14 天正確率">
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={stats.daily} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={1} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number, name: string) => (name === 'acc' ? `${v}%` : v)} />
                <Bar dataKey="acc" name="正確率" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}

function WordManager() {
  const [words, setWords] = useState<SpellingWord[] | null>(null);
  const [grp, setGrp] = useState<'all' | 'personal' | 'academic'>('all');
  const [form, setForm] = useState({ word: '', grp: 'personal', hint: '' });
  const [toast, showToast] = useToast();

  const load = useCallback(
    async () => setWords(await api.get<SpellingWord[]>(`/api/spelling/words?grp=${grp}`)),
    [grp]
  );
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!form.word.trim()) return;
    try {
      await api.post('/api/spelling/words', form);
      setForm({ ...form, word: '', hint: '' });
      showToast('已加入詞庫');
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  if (!words) return <Spinner />;

  return (
    <div className="space-y-3">
      {toast}
      <Card title="新增單字">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="單字"
            value={form.word}
            onChange={(e) => setForm({ ...form, word: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <select className="input" value={form.grp} onChange={(e) => setForm({ ...form, grp: e.target.value })}>
            <option value="personal">個人錯字組</option>
            <option value="academic">學術高頻組</option>
          </select>
          <input
            className="input flex-1"
            placeholder="中文提示(選填)"
            value={form.hint}
            onChange={(e) => setForm({ ...form, hint: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn-primary" onClick={add}>
            加入
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-400">聽寫工房的錯字與錯誤本的拼寫類會自動流入個人錯字組</div>
      </Card>

      <div className="flex gap-2">
        {(
          [
            ['all', '全部'],
            ['personal', '個人錯字'],
            ['academic', '學術高頻'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={grp === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setGrp(k)}>
            {label}
          </button>
        ))}
      </div>

      <Card title={`詞庫(${words.length})`}>
        {words.length === 0 ? (
          <EmptyState text="這個組別還沒有單字" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-2">單字</th>
                <th className="py-2 pr-2">組別</th>
                <th className="py-2 pr-2">提示</th>
                <th className="py-2 pr-2">連對</th>
                <th className="py-2 pr-2">錯誤次數</th>
                <th className="py-2 pr-2">狀態</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {words.map((w) => (
                <tr key={w.id}>
                  <td className="py-1.5 pr-2 font-mono font-medium">{w.word}</td>
                  <td className="py-1.5 pr-2 text-xs text-slate-500">
                    {w.grp === 'personal' ? '個人' : '學術'}
                  </td>
                  <td className="py-1.5 pr-2 text-xs text-slate-500">{w.hint}</td>
                  <td className="py-1.5 pr-2">{w.correct_streak}</td>
                  <td className="py-1.5 pr-2">{w.wrong_count > 0 ? <span className="text-rose-600">{w.wrong_count}</span> : 0}</td>
                  <td className="py-1.5 pr-2">
                    {w.correct_streak >= 3 ? (
                      <span className="badge bg-emerald-100 text-emerald-700">熟練</span>
                    ) : w.retry_left > 0 ? (
                      <span className="badge bg-orange-100 text-orange-600">重打×{w.retry_left}</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-500">練習中</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      className="btn-ghost text-xs text-rose-500"
                      onClick={async () => {
                        if (confirm(`刪除 ${w.word}?`)) {
                          await api.del(`/api/spelling/words/${w.id}`);
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
