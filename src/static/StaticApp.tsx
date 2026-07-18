/** GitHub Pages 網頁版:免伺服器,資料存瀏覽器 localStorage */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import interviewQs from '../../seeds/interview_questions.json';
import seedErrors from '../../seeds/errors.json';
import seedSpelling from '../../seeds/spelling.json';
import seedPrompts from '../../seeds/writing_prompts.json';
import { armAudioKeepAlive, speakEn } from '../audio-utils';
import { Card, EmptyState, PageTitle, useToast } from '../components/ui';
import { useRecorder, useWebSpeech, webSpeechSupported } from '../hooks/useRecorder';
import BankPage, { BankTypePanel } from '../practice/BankPage';
import { PracticeCtx } from '../practice/context';
import { staticProvider } from './staticProvider';
import { aiCall, hasApiKey } from './ai';
import { analyzeBlob } from './audioMetrics';
import {
  errorsStore,
  exportAll,
  importAll,
  load,
  save,
  settingsStore,
  speakingStore,
  todayStr,
  wordsStore,
  writingStore,
  type StoredError,
  type StoredWord,
} from './store';

const NAV = [
  { to: '/', label: '總覽', icon: '🎯' },
  { to: '/reading', label: '閱讀', icon: '📖' },
  { to: '/listening', label: '聽力', icon: '👂' },
  { to: '/writing', label: '寫作', icon: '✍️' },
  { to: '/speaking', label: '口說', icon: '🎙️' },
  { to: '/spelling', label: '拼寫', icon: '🔤' },
  { to: '/errors', label: '錯誤本', icon: '📕' },
  { to: '/settings', label: '設定', icon: '⚙️' },
];

/** 首次開啟:把種子詞庫/錯誤本灌進 localStorage */
function initOnce() {
  if (load('inited', false)) return;
  if (wordsStore.all().length === 0) {
    const rows: StoredWord[] = [];
    for (const w of seedSpelling.personal) rows.push({ word: w.word, grp: 'personal', hint: w.hint, streak: 0, wrong: 0, retryLeft: 0, retryDate: '' });
    for (const w of seedSpelling.academic) rows.push({ word: w.word, grp: 'academic', hint: w.hint, streak: 0, wrong: 0, retryLeft: 0, retryDate: '' });
    wordsStore.saveAll(rows);
  }
  if (errorsStore.all().length === 0) {
    const rows: StoredError[] = seedErrors.map((e, i) => ({
      id: i + 1,
      cat: e.cat,
      wrong: e.wrong,
      correct: e.correct,
      note: e.note,
      source: '種子',
      repeat: 0,
      date: '2026-07-10',
    }));
    errorsStore.saveAll(rows);
  }
  save('inited', true);
}

export default function StaticApp() {
  useEffect(() => {
    initOnce();
    const arm = () => armAudioKeepAlive();
    window.addEventListener('pointerdown', arm, { once: true });
    return () => window.removeEventListener('pointerdown', arm);
  }, []);

  return (
    <PracticeCtx.Provider value={staticProvider}>
      <HashRouter>
        <div className="flex min-h-screen flex-col md:flex-row">
          <aside className="md:fixed md:inset-y-0 md:left-0 md:w-48 bg-slate-900 text-slate-200 flex md:flex-col overflow-x-auto">
            <div className="hidden md:block px-4 py-5">
              <div className="text-lg font-bold text-white">TOEFL 練功坊</div>
              <div className="text-xs text-slate-400 mt-1">新制題庫·資料存本機瀏覽器</div>
            </div>
            <nav className="flex md:flex-col flex-1 md:space-y-0.5 md:px-2 px-1 py-1">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                      isActive ? 'bg-brand-600 text-white font-medium' : 'text-slate-300 hover:bg-slate-800'
                    }`
                  }
                >
                  <span>{n.icon}</span>
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </aside>
          <main className="md:ml-48 flex-1 p-4 md:p-6 max-w-5xl w-full">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route
                path="/reading"
                element={
                  <BankPage
                    title="閱讀訓練"
                    sub="完形填空(≤2分/篇)·日常生活閱讀(≤45秒/題)·學術短文"
                    tabs={[{ qtype: 'ctw' }, { qtype: 'daily_life' }, { qtype: 'academic' }]}
                  />
                }
              />
              <Route
                path="/listening"
                element={
                  <BankPage
                    title="聽力訓練"
                    sub="TTS 朗讀·句子應答·二人對話·公告·學術短講·交卷後看原文"
                    tabs={[{ qtype: 'lcr' }, { qtype: 'conversation' }, { qtype: 'announcement' }, { qtype: 'talk' }]}
                  />
                }
              />
              <Route path="/writing" element={<StaticWriting />} />
              <Route path="/speaking" element={<StaticSpeaking />} />
              <Route path="/spelling" element={<StaticSpelling />} />
              <Route path="/errors" element={<StaticErrors />} />
              <Route path="/settings" element={<StaticSettings />} />
            </Routes>
          </main>
        </div>
      </HashRouter>
    </PracticeCtx.Provider>
  );
}

/* ---------------- 總覽 ---------------- */

function Home() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof staticProvider.stats>> | null>(null);
  useEffect(() => {
    staticProvider.stats().then(setStats);
  }, []);
  const today = todayStr();
  const todayRows = stats?.daily.filter((d) => d.date === today) ?? [];
  const todayN = todayRows.reduce((s, d) => s + d.n, 0);
  return (
    <div>
      <PageTitle title="TOEFL 練功坊" sub={`新制(2026)全題型題庫·今天 ${today}·考試日 9/19`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-4">
        <div className="card text-center">
          <div className="text-3xl font-black text-brand-600">{todayN}</div>
          <div className="text-xs text-slate-500">今日已練(次)</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-black text-slate-800">{stats?.totals.reduce((s, t) => s + t.attempts, 0) ?? 0}</div>
          <div className="text-xs text-slate-500">總練習次數</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-black text-emerald-600">
            {stats && stats.totals.length > 0
              ? Math.round(stats.totals.reduce((s, t) => s + t.avg * t.attempts, 0) / Math.max(1, stats.totals.reduce((s, t) => s + t.attempts, 0)))
              : '—'}
          </div>
          <div className="text-xs text-slate-500">平均正確率</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-black text-slate-800">{stats?.bankCounts.reduce((s, b) => s + b.n, 0) ?? 0}</div>
          <div className="text-xs text-slate-500">題庫總題數(可 AI 加)</div>
        </div>
      </div>
      <Card title="各題型狀況">
        {!stats || stats.totals.length === 0 ? (
          <EmptyState text="還沒開始練。從左邊選一科開始!" />
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {stats.totals.map((t) => (
                <tr key={t.qtype}>
                  <td className="py-1.5">{t.qtype}</td>
                  <td className="py-1.5">{t.attempts} 次</td>
                  <td className="py-1.5 font-bold">{Math.round(t.avg)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="mt-3 text-xs text-slate-400">
        ⚠️ 資料只存在這台裝置的瀏覽器。跨裝置請到「設定」匯出/匯入 JSON。完整版(whisper 轉錄、65 天計畫、影片追蹤)在本機 localhost 平台。
      </div>
    </div>
  );
}

/* ---------------- 寫作(BS + Email/Discussion) ---------------- */

const KIND_SEC = { email: 420, discussion: 600 } as const;

function StaticWriting() {
  const [tab, setTab] = useState<'bs' | 'email' | 'discussion' | 'history'>('bs');
  return (
    <div>
      <PageTitle title="寫作訓練" sub="組織句子 60 秒·Email 7 分鐘·Discussion 10 分鐘·AI 批改需在設定填 API key" />
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['bs', '組織句子'],
            ['email', 'Write an Email'],
            ['discussion', 'Academic Discussion'],
            ['history', '紀錄'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'bs' && <BankTypePanel qtype="build_sentence" />}
      {(tab === 'email' || tab === 'discussion') && <StaticEssay kind={tab} key={tab} />}
      {tab === 'history' && <WritingHistory />}
    </div>
  );
}

function StaticEssay({ kind }: { kind: 'email' | 'discussion' }) {
  const prompts = useMemo(() => (seedPrompts as { kind: string; title: string; prompt: string }[]).filter((p) => p.kind === kind), [kind]);
  const [pi, setPi] = useState(0);
  const [stage, setStage] = useState<'pick' | 'write' | 'done'>('pick');
  const [answer, setAnswer] = useState('');
  const [secondsLeft, setSecondsLeft] = useState<number>(KIND_SEC[kind]);
  const [locked, setLocked] = useState(false);
  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (stage !== 'write' || locked) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setLocked(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [stage, locked]);

  const words = (answer.match(/[A-Za-z0-9'’-]+/g) || []).length;

  async function grade() {
    setGrading(true);
    try {
      const r = await aiCall(kind === 'email' ? 'grade_email' : 'grade_discussion', {
        prompt: prompts[pi].prompt,
        answer,
      });
      const fb = (r.parsed ?? { comment: r.text }) as Record<string, unknown>;
      setFeedback(fb);
      const rows = writingStore.all();
      rows.push({
        id: Date.now(),
        kind,
        prompt: prompts[pi].title,
        answer,
        seconds: KIND_SEC[kind] - secondsLeft,
        score: typeof fb.score === 'number' ? (fb.score as number) : null,
        score100: typeof fb.score100 === 'number' ? (fb.score100 as number) : null,
        feedback: fb,
        date: todayStr(),
      });
      writingStore.saveAll(rows);
      setStage('done');
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setGrading(false);
    }
  }

  if (stage === 'pick') {
    return (
      <div className="space-y-3">
        {toast}
        <Card title="選題">
          <select className="input w-full mb-2" value={pi} onChange={(e) => setPi(Number(e.target.value))}>
            {prompts.map((p, i) => (
              <option key={i} value={i}>
                {p.title}
              </option>
            ))}
          </select>
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {prompts[pi]?.prompt}
          </div>
          <button
            className="btn-primary mt-3"
            onClick={() => {
              setAnswer('');
              setSecondsLeft(KIND_SEC[kind]);
              setLocked(false);
              setFeedback(null);
              setStage('write');
            }}
          >
            ▶ 開始作答({KIND_SEC[kind] / 60} 分鐘)
          </button>
        </Card>
      </div>
    );
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const fb = feedback as {
    score?: number;
    score100?: number;
    task_check?: { task: string; done: boolean }[];
    errors?: { category: string; wrong: string; correct: string; note?: string }[];
    improved_version?: string;
    comment?: string;
  } | null;

  return (
    <div className="space-y-3">
      {toast}
      <div className={`card flex items-center justify-between py-2.5 ${secondsLeft === 0 ? 'bg-rose-50 border-rose-300' : ''}`}>
        <span className={`text-2xl font-black tabular-nums ${secondsLeft < 60 ? 'text-rose-600' : 'text-slate-800'}`}>
          {mm}:{ss}
        </span>
        <span className={`text-sm ${kind === 'discussion' && words < 100 ? 'text-rose-600' : 'text-slate-600'}`}>{words} 字</span>
      </div>
      <div className="card max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">{prompts[pi]?.prompt}</div>
      <textarea
        className="input w-full font-mono text-sm"
        rows={12}
        value={answer}
        readOnly={locked && stage !== 'done'}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="在這裡作答..."
      />
      {stage === 'write' && (
        <div className="flex gap-2">
          <button className="btn-primary" onClick={grade} disabled={grading || words === 0}>
            {grading ? 'AI 批改中...' : '送出 AI 批改'}
          </button>
          {locked && <span className="badge bg-rose-100 text-rose-600 self-center">時間到(仍可送批改)</span>}
          <button className="btn-secondary" onClick={() => setStage('pick')}>
            返回
          </button>
        </div>
      )}
      {stage === 'done' && fb && (
        <Card title="批改結果">
          <div className="mb-2 flex items-center gap-4">
            <span className="text-3xl font-black text-brand-600">{fb.score ?? '—'}<span className="text-sm text-slate-400">/5</span></span>
            <span className="text-3xl font-black text-emerald-600">{fb.score100 ?? '—'}<span className="text-sm text-slate-400">/100</span></span>
            <button
              className="btn-secondary ml-auto"
              onClick={() => {
                for (const e of fb.errors ?? []) errorsStore.add({ cat: e.category, wrong: e.wrong, correct: e.correct, note: e.note ?? '', source: 'AI批改' });
                showToast(`已加入錯誤本 ${(fb.errors ?? []).length} 筆`);
              }}
              disabled={!fb.errors?.length}
            >
              錯誤全部入錯誤本
            </button>
          </div>
          {fb.task_check && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {fb.task_check.map((t, i) => (
                <span key={i} className={`badge ${t.done ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {t.done ? '✓' : '✗'} {t.task}
                </span>
              ))}
            </div>
          )}
          {(fb.errors ?? []).map((e, i) => (
            <div key={i} className="text-sm py-0.5">
              <span className="text-rose-600 line-through">{e.wrong}</span> → <span className="text-emerald-700">{e.correct}</span>
              <span className="text-xs text-slate-400 ml-1">{e.note}</span>
            </div>
          ))}
          {fb.improved_version && <div className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-800 whitespace-pre-wrap">{fb.improved_version}</div>}
          {fb.comment && <div className="mt-2 text-sm text-slate-700">{fb.comment}</div>}
          <button className="btn-primary mt-3" onClick={() => setStage('pick')}>
            再練一題
          </button>
        </Card>
      )}
    </div>
  );
}

function WritingHistory() {
  const rows = writingStore.all().slice().reverse();
  return (
    <Card title={`寫作紀錄(${rows.length})`}>
      {rows.length === 0 ? (
        <EmptyState text="還沒有紀錄" />
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-1.5 pr-2 text-xs text-slate-400">{r.date.slice(5)}</td>
                <td className="py-1.5 pr-2">{r.kind === 'email' ? 'Email' : 'Discussion'}</td>
                <td className="py-1.5 pr-2 truncate max-w-[200px]">{r.prompt}</td>
                <td className="py-1.5 font-bold">{r.score ?? '—'}/5</td>
                <td className="py-1.5 font-bold text-emerald-600">{r.score100 ?? '—'}/100</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ---------------- 口說(L&R 考試 + Interview) ---------------- */

function StaticSpeaking() {
  const [tab, setTab] = useState<'lnr' | 'interview'>('lnr');
  return (
    <div>
      <PageTitle title="口說訓練" sub="L&R 七句連發(即時轉錄比對)·Interview 45 秒(瀏覽器算三指標)·建議用 Chrome" />
      <div className="mb-4 flex gap-2">
        <button className={tab === 'lnr' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('lnr')}>
          Listen & Repeat
        </button>
        <button className={tab === 'interview' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('interview')}>
          Take an Interview
        </button>
      </div>
      {tab === 'lnr' && <BankTypePanel qtype="lnr_set" />}
      {tab === 'interview' && <StaticInterview />}
    </div>
  );
}

function StaticInterview() {
  const questions = interviewQs as string[];
  const [q, setQ] = useState('');
  const [result, setResult] = useState<{ duration: number; deadAir: number; voiced: number; transcript: string; url: string } | null>(null);
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(null);
  const [feedbacking, setFeedbacking] = useState(false);
  const recorder = useRecorder();
  const speech = useWebSpeech();
  const [toast, showToast] = useToast();

  function start() {
    const pick = questions[Math.floor(Math.random() * questions.length)];
    setQ(pick);
    setResult(null);
    setFeedback(null);
    if (webSpeechSupported()) speech.start();
    recorder.start({
      countdownSec: 3,
      maxSeconds: 45,
      onStop: async (blob) => {
        const transcript = webSpeechSupported() ? speech.stop() : '';
        const m = await analyzeBlob(blob).catch(() => ({ duration: 0, deadAirCount: 0, voicedSeconds: 0 }));
        const url = URL.createObjectURL(blob);
        setResult({ duration: m.duration, deadAir: m.deadAirCount, voiced: m.voicedSeconds, transcript, url });
        const rows = speakingStore.all();
        rows.push({ id: Date.now(), question: q || pick, duration: m.duration, deadAir: m.deadAirCount, voiced: m.voicedSeconds, transcript, feedback: null, score100: null, date: todayStr() });
        speakingStore.saveAll(rows);
      },
    });
  }

  async function getFeedback() {
    if (!result?.transcript) {
      showToast('沒有逐字稿(此瀏覽器可能不支援即時轉錄,請用 Chrome)', 'err');
      return;
    }
    setFeedbacking(true);
    try {
      const r = await aiCall('speaking_feedback', { question: q, transcript: result.transcript });
      const fb = (r.parsed ?? { comment: r.text }) as Record<string, unknown>;
      setFeedback(fb);
      const rows = speakingStore.all();
      const last = rows[rows.length - 1];
      if (last) {
        last.feedback = fb;
        last.score100 = typeof fb.score100 === 'number' ? (fb.score100 as number) : null;
        speakingStore.saveAll(rows);
      }
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setFeedbacking(false);
    }
  }

  const busy = recorder.state === 'countdown' || recorder.state === 'recording';
  const fb = feedback as { score100?: number; errors?: { category: string; wrong: string; correct: string }[]; natural_version?: string; are_advice?: string; comment?: string } | null;

  return (
    <div className="space-y-3">
      {toast}
      {!busy && !result && (
        <Card>
          <button className="btn-primary" onClick={start}>
            🎲 隨機一題開始(3 秒倒數 → 錄 45 秒)
          </button>
          {!webSpeechSupported() && <div className="mt-2 text-xs text-rose-500">此瀏覽器不支援即時轉錄(逐字稿/AI 回饋需要),建議 Chrome</div>}
        </Card>
      )}
      {recorder.error && <div className="card border-rose-300 bg-rose-50 text-sm text-rose-700">{recorder.error}</div>}
      {busy && (
        <Card className="text-center">
          <div className="mb-3 text-lg font-bold text-slate-800 px-4">{q}</div>
          {recorder.state === 'countdown' ? (
            <div className="text-6xl font-black text-brand-600 py-4">{recorder.countdown}</div>
          ) : (
            <div className="py-3">
              <div className="mb-2 text-rose-600 font-bold">● 錄音中 {recorder.elapsed.toFixed(1)}s/45s</div>
              {speech.live && <div className="mx-auto max-w-md text-xs text-slate-500 bg-slate-50 rounded p-2 max-h-16 overflow-y-auto">{speech.live}</div>}
              <button className="btn-secondary mt-3" onClick={recorder.stop}>提前結束</button>
            </div>
          )}
        </Card>
      )}
      {result && (
        <Card title={q}>
          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div className={`rounded-lg p-2 ${result.deadAir > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
              <div className="text-2xl font-black">{result.deadAir}</div>
              <div className="text-xs">≥3 秒死寂</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <div className="text-2xl font-black">{result.voiced}s</div>
              <div className="text-xs text-slate-500">發聲(總長 {result.duration}s)</div>
            </div>
            <div className={`rounded-lg p-2 ${fb?.score100 !== undefined ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50'}`}>
              <div className="text-2xl font-black">{fb?.score100 ?? '—'}</div>
              <div className="text-xs text-slate-500">新制百分</div>
            </div>
          </div>
          <audio controls src={result.url} className="w-full h-9 mb-2" />
          <div className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700 mb-2">
            {result.transcript || '(沒有逐字稿)'}
          </div>
          {!fb ? (
            <div className="flex gap-2">
              <button className="btn-primary" onClick={getFeedback} disabled={feedbacking || !result.transcript}>
                {feedbacking ? 'AI 回饋中...' : '🤖 AI 回饋+百分制評分'}
              </button>
              <button className="btn-secondary" onClick={start}>再練一題</button>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {(fb.errors ?? []).map((e, i) => (
                <div key={i}>
                  <span className="text-rose-600 line-through">{e.wrong}</span> → <span className="text-emerald-700">{e.correct}</span>
                </div>
              ))}
              {fb.natural_version && <div className="rounded bg-emerald-50 p-2 text-emerald-800">{fb.natural_version}</div>}
              {fb.are_advice && <div className="rounded bg-amber-50 p-2 text-amber-800 text-xs">{fb.are_advice}</div>}
              {fb.comment && <div className="text-slate-600 text-xs">{fb.comment}</div>}
              <button
                className="btn-secondary"
                onClick={() => {
                  for (const e of fb.errors ?? []) errorsStore.add({ cat: e.category, wrong: e.wrong, correct: e.correct, note: '', source: '口說回饋' });
                  showToast('已加入錯誤本');
                }}
              >
                錯誤入錯誤本
              </button>
              <button className="btn-primary ml-2" onClick={start}>再練一題</button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ---------------- 拼寫 ---------------- */

function StaticSpelling() {
  const [word, setWord] = useState<StoredWord | null>(null);
  const [mode, setMode] = useState<'zh' | 'letters'>('zh');
  const [answer, setAnswer] = useState('');
  const [fbk, setFbk] = useState<{ correct: boolean; word: string } | null>(null);
  const [count, setCount] = useState({ total: 0, ok: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback((excludeWord?: string) => {
    const rows = wordsStore.all();
    if (rows.length === 0) return;
    const today = todayStr();
    const weight = (w: StoredWord) =>
      w.retryLeft > 0 && w.retryDate === today ? 12 : w.streak >= 3 ? 1 : 3 + Math.min(w.wrong * 2, 6);
    const pool = rows.filter((w) => w.word !== excludeWord);
    const list = pool.length > 0 ? pool : rows;
    const total = list.reduce((s, w) => s + weight(w), 0);
    let roll = Math.random() * total;
    let picked = list[0];
    for (const w of list) {
      roll -= weight(w);
      if (roll <= 0) {
        picked = w;
        break;
      }
    }
    setWord(picked);
    setAnswer('');
    setFbk(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    pick();
  }, [pick]);

  function submit() {
    if (!word || fbk) return;
    const ok = answer.trim().toLowerCase() === word.word.toLowerCase();
    const rows = wordsStore.all();
    const w = rows.find((x) => x.word === word.word && x.grp === word.grp);
    if (w) {
      const today = todayStr();
      if (ok) {
        w.streak += 1;
        if (w.retryLeft > 0 && w.retryDate === today) w.retryLeft -= 1;
      } else {
        w.streak = 0;
        w.wrong += 1;
        w.retryLeft = 3;
        w.retryDate = today;
      }
      wordsStore.saveAll(rows);
    }
    setFbk({ correct: ok, word: word.word });
    setCount((c) => ({ total: c.total + 1, ok: c.ok + (ok ? 1 : 0) }));
    if (ok) setTimeout(() => pick(word.word), 650);
  }

  if (!word) return <EmptyState text="詞庫是空的" />;

  return (
    <div>
      <PageTitle title="拼寫特訓" sub="答錯進今日重打 3 次佇列·答對 3 次降頻" />
      <div className="mb-3 flex gap-2 items-center">
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1">
          {(
            [
              ['zh', '中文提示'],
              ['letters', '首 2 字母'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`rounded-md px-3 py-1 text-sm ${mode === k ? 'bg-white shadow' : 'text-slate-600'}`} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-slate-500">本輪 {count.ok}/{count.total}</span>
      </div>
      <Card className={fbk ? (fbk.correct ? 'border-emerald-400' : 'border-rose-400') : ''}>
        <div className="py-5 text-center">
          <div className="text-2xl font-bold text-slate-800 mb-3">
            {mode === 'zh' ? word.hint || '(無提示)' : `${word.word.slice(0, 2)}${'·'.repeat(Math.max(0, word.word.length - 2))}`}
            <span className="ml-2 text-xs font-normal text-slate-400">({word.word.length} 字母)</span>
          </div>
          <div className="flex justify-center gap-2">
            <input
              ref={inputRef}
              className="input w-64 text-center text-lg font-mono"
              value={answer}
              readOnly={!!fbk && !fbk.correct}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (fbk && !fbk.correct ? pick(word.word) : submit())}
              placeholder="輸入完整拼寫,Enter 送出"
            />
            <button className="btn-primary" onClick={() => (fbk && !fbk.correct ? pick(word.word) : submit())}>
              {fbk && !fbk.correct ? '下一題' : '送出'}
            </button>
          </div>
          {fbk && (
            <div className={`mt-3 text-lg font-bold ${fbk.correct ? 'text-emerald-600' : 'text-rose-600'}`}>
              {fbk.correct ? '✓ 正確!' : (
                <>
                  ✗ 正解:<span className="font-mono">{fbk.word}</span>
                  <button className="btn-ghost ml-2 text-sm" onClick={() => speakEn(fbk.word)}>🔊</button>
                </>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- 錯誤本 ---------------- */

const CATS = ['單複數/冠詞', '時態/三單', '拼寫', '固定搭配'];

function StaticErrors() {
  const [rows, setRows] = useState<StoredError[]>(errorsStore.all());
  const [form, setForm] = useState({ cat: CATS[0], wrong: '', correct: '', note: '' });
  const refresh = () => setRows(errorsStore.all());

  return (
    <div>
      <PageTitle title="錯誤本" sub="四分類·AI 批改的錯誤可一鍵匯入" />
      <Card className="mb-3">
        <div className="grid grid-cols-12 gap-2">
          <select className="input col-span-3 md:col-span-2" value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })}>
            {CATS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input className="input col-span-4 md:col-span-3" placeholder="錯誤" value={form.wrong} onChange={(e) => setForm({ ...form, wrong: e.target.value })} />
          <input className="input col-span-4 md:col-span-3" placeholder="正確" value={form.correct} onChange={(e) => setForm({ ...form, correct: e.target.value })} />
          <input className="input hidden md:block md:col-span-3" placeholder="備註" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button
            className="btn-primary col-span-1"
            onClick={() => {
              if (!form.wrong.trim() || !form.correct.trim()) return;
              errorsStore.add({ cat: form.cat, wrong: form.wrong, correct: form.correct, note: form.note, source: '手動' });
              setForm({ ...form, wrong: '', correct: '', note: '' });
              refresh();
            }}
          >
            存
          </button>
        </div>
      </Card>
      <Card title={`共 ${rows.length} 筆`}>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows
              .slice()
              .reverse()
              .map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-2"><span className="badge bg-slate-100 text-slate-600">{r.cat}</span></td>
                  <td className="py-1.5 pr-2 text-rose-600">{r.wrong}</td>
                  <td className="py-1.5 pr-2 text-emerald-700 font-medium">{r.correct}</td>
                  <td className="py-1.5 pr-2 text-xs text-slate-400 hidden md:table-cell">{r.note}</td>
                  <td className="py-1.5 pr-2">{r.repeat > 0 && <span className="badge bg-rose-100 text-rose-600">×{r.repeat}</span>}</td>
                  <td className="py-1.5 text-right">
                    <button
                      className="btn-ghost text-xs text-rose-500"
                      onClick={() => {
                        errorsStore.saveAll(rows.filter((x) => x.id !== r.id));
                        refresh();
                      }}
                    >
                      刪
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ---------------- 設定 ---------------- */

function StaticSettings() {
  const [s, setS] = useState(settingsStore.get());
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // 一鍵搬設定:開啟含 ?setup= 的連結自動匯入(內容在 # 之後,不會傳到任何伺服器)
  useEffect(() => {
    const setup = searchParams.get('setup');
    if (!setup) return;
    try {
      const parsed = JSON.parse(atob(setup)) as Partial<ReturnType<typeof settingsStore.get>> & {
        k?: string;
        m?: string;
      };
      const next = {
        ...settingsStore.get(),
        ...(parsed.aiSource ? parsed : {}),
        ...(parsed.k ? { apiKey: parsed.k, model: parsed.m || 'claude-sonnet-4-6' } : {}),
      };
      settingsStore.set(next);
      setS(next);
      showToast('✓ 設定已從連結匯入這台裝置');
    } catch {
      showToast('設定連結格式不正確', 'err');
    }
    setSearchParams({}, { replace: true }); // 立刻從網址列清掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copySetupLink() {
    settingsStore.set(s);
    const payload = btoa(JSON.stringify(s));
    const url = `${location.origin}${location.pathname}#/settings?setup=${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('✓ 設定連結已複製!在新裝置開這個連結即完成設定(只能傳給你自己)');
    } catch {
      prompt('複製這個連結,到新裝置開啟:', url);
    }
  }

  async function test() {
    settingsStore.set(s);
    setTesting(true);
    setTestMsg('');
    try {
      const r = await aiCall('speaking_feedback', { question: 'test', transcript: 'This is a connection test, reply anything.' });
      setTestMsg(`✓ 連線成功(${r.text.length > 0 ? '有回應' : '空回應'})`);
    } catch (e) {
      setTestMsg(`✗ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      {toast}
      <PageTitle title="設定" sub="API 金鑰只存在這台裝置的瀏覽器,不會上傳到任何伺服器" />
      <Card title="AI 批改來源" className="mb-3">
        <div className="space-y-2">
          <label
            className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${s.aiSource === 'server' ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
          >
            <input type="radio" checked={s.aiSource === 'server'} onChange={() => setS({ ...s, aiSource: 'server' })} className="mt-1" />
            <div className="flex-1">
              <div className="font-medium text-slate-800">A|本機伺服器(你的 Claude 訂閱,免費)</div>
              <div className="text-xs text-slate-500 mt-0.5">
                同一台電腦上 <code className="bg-slate-100 px-1 rounded">npm run dev</code> 開著就能用,批改走 Claude Code
                訂閱、零 API 費用。換到手機/其他電腦時連不到,要改用 B。
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="label">伺服器位址</span>
                <input className="input w-56 text-xs" value={s.serverUrl} onChange={(e) => setS({ ...s, serverUrl: e.target.value })} />
              </div>
            </div>
          </label>
          <label
            className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${s.aiSource === 'api' ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
          >
            <input type="radio" checked={s.aiSource === 'api'} onChange={() => setS({ ...s, aiSource: 'api' })} className="mt-1" />
            <div className="flex-1">
              <div className="font-medium text-slate-800">B|直連 Anthropic API(任何裝置可用,需金鑰)</div>
              <div className="mt-1.5">
                <div className="label mb-1">API Key(sk-ant-...)</div>
                <input
                  className="input w-full font-mono text-xs"
                  type="password"
                  value={s.apiKey}
                  onChange={(e) => setS({ ...s, apiKey: e.target.value })}
                  placeholder="到 console.anthropic.com 建立"
                />
              </div>
              <div className="mt-1.5">
                <div className="label mb-1">模型</div>
                <input className="input w-64 text-xs" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
              </div>
            </div>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                settingsStore.set(s);
                showToast('已儲存');
              }}
            >
              儲存
            </button>
            <button className="btn-secondary" onClick={test} disabled={testing || (s.aiSource === 'api' && !s.apiKey.trim())}>
              {testing ? '測試中...' : '連線測試'}
            </button>
            <button className="btn-secondary" onClick={copySetupLink} title="在手機/其他電腦開這個連結,設定自動完成">
              📲 複製「一鍵設定連結」給其他裝置
            </button>
          </div>
          {testMsg && <div className={`text-sm ${testMsg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>{testMsg}</div>}
          <div className="text-xs text-slate-400">
            不設 AI 也能用:所有客觀題(閱讀/聽力/組織句子/L&R 比對/拼寫)完全不需要 AI;AI 只用於寫作批改、口說回饋、AI 出題。
            {hasApiKey() && ' 目前 AI 已可用 ✓'}
          </div>
        </div>
      </Card>
      <Card title="資料備份(跨裝置搬家用)">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary"
            onClick={() => {
              const blob = new Blob([exportAll()], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `toefl-web-backup-${Date.now()}.json`;
              a.click();
            }}
          >
            ⬇ 匯出 JSON
          </button>
          <input ref={fileRef} type="file" accept=".json" className="text-sm" />
          <button
            className="btn-danger"
            onClick={async () => {
              const f = fileRef.current?.files?.[0];
              if (!f) return showToast('先選檔案', 'err');
              if (!confirm('匯入會覆蓋此裝置上的資料,確定?')) return;
              try {
                importAll(await f.text());
                showToast('匯入完成,重新整理頁面生效');
              } catch (e) {
                showToast((e as Error).message, 'err');
              }
            }}
          >
            ⬆ 匯入
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-400">練習成績、錯誤本、拼寫進度、AI 出的題都在備份內;錄音檔不保存。</div>
      </Card>
    </div>
  );
}
