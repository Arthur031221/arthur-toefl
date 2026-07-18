import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { hashSeed, pickVoice, speakEn } from '../audio-utils';
import { Card, EmptyState, PageTitle, Spinner, useToast } from '../components/ui';
import { BankTypePanel } from '../practice/BankPage';
import { useRecorder, useWebSpeech, webSpeechSupported } from '../hooks/useRecorder';
import type { RepeatMaterial, SpeakingFeedback, SpeakingSession, SystemStatus } from '../types';

interface Question {
  id: number;
  text: string;
  source: string;
}

export default function Speaking() {
  const [tab, setTab] = useState<'interview' | 'repeat' | 'history'>('interview');
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    api.get<SystemStatus>('/api/system/status').then(setStatus);
  }, []);

  return (
    <div>
      <PageTitle
        title="口說訓練室"
        sub="Take an Interview 45 秒模擬·三指標(死寂/發聲/完句率)·Listen & Repeat 四步字幕法"
      />
      <div className="mb-4 flex gap-2">
        {(
          [
            ['interview', 'Take an Interview 模擬'],
            ['repeat', 'Listen & Repeat 跟讀'],
            ['history', '歷史·趨勢·A/B 對比'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'interview' && status && <Interview status={status} />}
      {tab === 'repeat' && <Repeat />}
      {tab === 'history' && <History />}
    </div>
  );
}

/* ================= Take an Interview ================= */

function Interview({ status }: { status: SystemStatus }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [mode, setMode] = useState<'single' | 'full'>('single');
  const [current, setCurrent] = useState<Question | null>(null);
  const [queue, setQueue] = useState<Question[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const [groupResults, setGroupResults] = useState<SpeakingSession[]>([]);
  const [session, setSession] = useState<SpeakingSession | null>(null);
  const [useWebSpeechLive, setUseWebSpeechLive] = useState(status.whisper === 'none' && webSpeechSupported());
  const [newQ, setNewQ] = useState('');
  const [toast, showToast] = useToast();
  const recorder = useRecorder();
  const speech = useWebSpeech();
  const groupIdRef = useRef('');
  // 重說:同題再錄一次(單題模式附上一次對比;全真模式原位更新該題)
  const [prevAttempt, setPrevAttempt] = useState<SpeakingSession | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryRef = useRef<{ groupIndex: number | null } | null>(null);

  const load = useCallback(async () => {
    const qs = await api.get<Question[]>('/api/speaking/questions');
    setQuestions(qs);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function pickRandom(n: number): Question[] {
    const pool = [...questions];
    const out: Question[] = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  }

  async function startSingle(q?: Question) {
    const question = q ?? pickRandom(1)[0];
    if (!question) return;
    setSession(null);
    setGroupResults([]);
    setCurrent(question);
    groupIdRef.current = '';
    beginRecording(question, '');
  }

  async function startFull() {
    const qs = pickRandom(4);
    if (qs.length < 4) {
      showToast('題庫不足 4 題', 'err');
      return;
    }
    setSession(null);
    setGroupResults([]);
    setQueue(qs);
    setQueueIdx(0);
    queueIdxRef.current = 0;
    setCurrent(qs[0]);
    groupIdRef.current = `g${Date.now().toString(36)}`;
    beginRecording(qs[0], groupIdRef.current);
  }

  function beginRecording(question: Question, groupId: string) {
    if (useWebSpeechLive) speech.start();
    recorder.start({
      countdownSec: 3,
      maxSeconds: 45,
      onStop: (blob, lead) => void handleStop(blob, question, groupId, lead),
    });
  }

  /** 重說同一題:groupIndex=null 表單題模式(帶上一次成績做對比) */
  function retryQuestion(question: Question, groupIndex: number | null, prev?: SpeakingSession) {
    retryRef.current = { groupIndex };
    setRetrying(true);
    if (groupIndex === null) {
      setPrevAttempt(prev ?? null);
      setSession(null);
    }
    setCurrent(question);
    beginRecording(question, groupIndex !== null ? groupIdRef.current : '');
  }

  async function handleStop(blob: Blob, question: Question, groupId: string, lead: number) {
    const webSpeechText = useWebSpeechLive ? speech.stop() : '';
    const form = new FormData();
    form.append('mode', 'interview');
    form.append('question', question.text);
    form.append('question_id', String(question.id));
    form.append('group_id', groupId);
    form.append('lead', String(lead));
    form.append('audio', blob, 'rec.webm');
    try {
      const r = await api.upload<{ session: SpeakingSession; analysisError?: string }>('/api/speaking/upload', form);
      let s = r.session;
      if (r.analysisError) showToast(`指標分析失敗:${r.analysisError}`, 'err');
      if (webSpeechText) {
        s = await api.patch<SpeakingSession>(`/api/speaking/sessions/${s.id}`, {
          transcript: webSpeechText,
          transcript_source: 'webspeech',
        });
      }
      // 重說:不推進題目佇列,單題顯示新結果、全真原位替換該題
      const retry = retryRef.current;
      if (retry) {
        retryRef.current = null;
        setRetrying(false);
        if (retry.groupIndex !== null) {
          setGroupResults((prev) => prev.map((x, i) => (i === retry.groupIndex ? s : x)));
          setCurrent(null);
          showToast('重說完成,該題結果已更新(舊紀錄保留在歷史頁)');
        } else {
          setSession(s);
        }
        return;
      }
      if (groupId) {
        // 全真模式:2 秒後進下一題(副作用不放進 state updater,避免 StrictMode 雙重執行)
        setGroupResults((prev) => [...prev, s]);
        const nextIdx = queueIdxRef.current + 1;
        queueIdxRef.current = nextIdx;
        setQueueIdx(nextIdx);
        if (nextIdx < 4) {
          setTimeout(() => {
            setCurrent(queueRef.current[nextIdx]);
            beginRecording(queueRef.current[nextIdx], groupId);
          }, 2000);
        } else {
          setCurrent(null);
          showToast('4 題連做完成!逐題轉逐字稿+回饋吧');
        }
      } else {
        setSession(s);
      }
    } catch (e) {
      showToast(`上傳失敗:${(e as Error).message}`, 'err');
    }
  }

  // queue 與進度的最新參照(setTimeout 閉包用)
  const queueRef = useRef<Question[]>([]);
  queueRef.current = queue;
  const queueIdxRef = useRef(0);

  async function addQuestion() {
    if (!newQ.trim()) return;
    await api.post('/api/speaking/questions', { text: newQ });
    setNewQ('');
    load();
    showToast('已新增題目');
  }

  const busy = recorder.state === 'countdown' || recorder.state === 'recording';

  return (
    <div className="space-y-4">
      {toast}
      {/* 控制區 */}
      {!busy && !session && (
        <Card title="開始練習">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex gap-1 rounded-lg bg-slate-200 p-1">
              <button
                className={`rounded-md px-3 py-1 text-sm ${mode === 'single' ? 'bg-white shadow font-medium' : 'text-slate-600'}`}
                onClick={() => setMode('single')}
              >
                單題模式
              </button>
              <button
                className={`rounded-md px-3 py-1 text-sm ${mode === 'full' ? 'bg-white shadow font-medium' : 'text-slate-600'}`}
                onClick={() => setMode('full')}
              >
                全真模式(4 題連做·題間 2 秒)
              </button>
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={useWebSpeechLive}
                onChange={(e) => setUseWebSpeechLive(e.target.checked)}
                disabled={!webSpeechSupported()}
                className="h-4 w-4 rounded border-slate-300"
              />
              錄音同時即時轉錄(Chrome)
              {!webSpeechSupported() && '(此瀏覽器不支援)'}
            </label>
          </div>
          {mode === 'single' ? (
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => startSingle()}>
                🎲 隨機一題開始
              </button>
              <select
                className="input flex-1"
                onChange={(e) => {
                  const q = questions.find((x) => x.id === Number(e.target.value));
                  if (q) startSingle(q);
                }}
                value=""
              >
                <option value="" disabled>
                  或選定題目直接開始({questions.length} 題)...
                </option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.source === 'custom' ? '★' : ''}
                    {q.text}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button className="btn-primary" onClick={startFull}>
              ▶ 開始 4 題連做(模擬無準備時間)
            </button>
          )}
          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              placeholder="自行新增題目(英文)..."
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addQuestion()}
            />
            <button className="btn-secondary" onClick={addQuestion}>
              加入題庫
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            流程:按開始 → 顯示題目 → 3 秒倒數 → 自動錄音 45 秒 → 自動停止並算指標。ARE
            公式:Answer 1 句 → Reason 1–2 句 → Example 2 句;講滿 ≥35 秒。
          </div>
        </Card>
      )}

      {recorder.error && <div className="card border-rose-300 bg-rose-50 text-sm text-rose-700">{recorder.error}</div>}

      {/* 錄音中 */}
      {busy && current && (
        <Card className="text-center">
          <div className="text-xs text-slate-400 mb-2">
            {retrying ? '🔁 重說同題(重新計分)' : groupIdRef.current ? `全真模式·第 ${queueIdx + 1}/4 題` : '單題模式'}
          </div>
          <div className="text-xl font-bold text-slate-800 mb-4 px-8">{current.text}</div>
          {recorder.state === 'countdown' ? (
            <div className="text-7xl font-black text-brand-600 py-6">{recorder.countdown}</div>
          ) : (
            <div className="py-4">
              <div className="mb-3 flex items-center justify-center gap-2 text-rose-600 font-bold">
                <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-rose-600" />
                錄音中 {recorder.elapsed.toFixed(1)}s/45s
              </div>
              <div className="mx-auto h-3 w-2/3 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-all"
                  style={{ width: `${(recorder.elapsed / 45) * 100}%` }}
                />
              </div>
              {useWebSpeechLive && speech.live && (
                <div className="mt-4 mx-auto max-w-lg text-left text-xs text-slate-500 bg-slate-50 rounded-lg p-2 max-h-20 overflow-y-auto">
                  {speech.live}
                </div>
              )}
              <button className="btn-secondary mt-4" onClick={recorder.stop}>
                提前結束
              </button>
            </div>
          )}
        </Card>
      )}

      {/* 全真模式進度 */}
      {groupIdRef.current && groupResults.length > 0 && (
        <Card title={`全真模式結果(${groupResults.length}/4)`}>
          <div className="space-y-3">
            {groupResults.map((s, i) => (
              <SessionResult
                key={s.id}
                initial={s}
                label={`第 ${i + 1} 題`}
                status={status}
                onRetry={
                  busy
                    ? undefined
                    : () => retryQuestion(queueRef.current[i] ?? { id: 0, text: s.question, source: 'seed' }, i)
                }
              />
            ))}
          </div>
        </Card>
      )}

      {/* 單題結果 */}
      {session && !groupIdRef.current && (
        <>
          {prevAttempt && (
            <div className="card flex flex-wrap items-center gap-4 border-brand-200 bg-brand-50/60 text-sm">
              <span className="badge bg-brand-100 text-brand-700">重說對比</span>
              <span>
                死寂 {prevAttempt.dead_air_count} →{' '}
                <b className={session.dead_air_count <= prevAttempt.dead_air_count ? 'text-emerald-600' : 'text-rose-600'}>
                  {session.dead_air_count}
                </b>{' '}
                次
              </span>
              <span>
                發聲 {prevAttempt.voiced_seconds}s →{' '}
                <b className={session.voiced_seconds >= prevAttempt.voiced_seconds ? 'text-emerald-600' : 'text-rose-600'}>
                  {session.voiced_seconds}s
                </b>
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-slate-400">上一次錄音</span>
                <audio controls src={prevAttempt.audio_path} className="h-8" preload="none" />
              </div>
            </div>
          )}
          <SessionResult
            key={session.id}
            initial={session}
            status={status}
            onRetry={() =>
              retryQuestion(current ?? { id: 0, text: session.question, source: 'seed' }, null, session)
            }
          />
          <button
            className="btn-primary"
            onClick={() => {
              setSession(null);
              setPrevAttempt(null);
            }}
          >
            再練一題
          </button>
        </>
      )}
    </div>
  );
}

/* ---- 單次錄音的結果卡(指標+轉錄+回饋) ---- */

function SessionResult({
  initial,
  label,
  status,
  onRetry,
}: {
  initial: SpeakingSession;
  label?: string;
  status: SystemStatus;
  onRetry?: () => void;
}) {
  const [s, setS] = useState(initial);
  const [transcribing, setTranscribing] = useState(false);
  const [feedbacking, setFeedbacking] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState('');
  const [added, setAdded] = useState(false);
  const [toast, showToast] = useToast();

  const feedback: SpeakingFeedback | null = s.feedback ? safeParse(s.feedback) : null;

  async function transcribe() {
    setTranscribing(true);
    try {
      await api.post(`/api/speaking/sessions/${s.id}/transcribe`);
      setS(await api.get<SpeakingSession>(`/api/speaking/sessions/${s.id}`));
      showToast('轉錄完成');
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setTranscribing(false);
    }
  }

  async function saveManual() {
    const updated = await api.patch<SpeakingSession>(`/api/speaking/sessions/${s.id}`, {
      transcript: manualText,
      transcript_source: 'manual',
    });
    setS(updated);
    setManual(false);
  }

  async function getFeedback() {
    setFeedbacking(true);
    try {
      const r = await api.post<{ parsed: SpeakingFeedback | null; raw: string }>(
        `/api/speaking/sessions/${s.id}/feedback`
      );
      setS({ ...s, feedback: JSON.stringify(r.parsed ?? { comment: r.raw }) });
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setFeedbacking(false);
    }
  }

  async function addErrors() {
    if (!feedback?.errors?.length) return;
    const r = await api.post<{ added: number }>('/api/errors/bulk', {
      errors: feedback.errors,
      source: '口說回饋',
    });
    setAdded(true);
    showToast(`已加入錯誤本 ${r.added} 筆`);
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-3">
      {toast}
      {label && <div className="text-xs font-semibold text-slate-400">{label}</div>}
      <div className="text-sm font-medium text-slate-700">{s.question}</div>

      {/* 三指標 */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={`rounded-lg p-2 ${s.dead_air_count > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          <div className="text-2xl font-black">{s.dead_air_count}</div>
          <div className="text-xs">≥3 秒死寂次數</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-2xl font-black text-slate-800">{s.voiced_seconds}s</div>
          <div className="text-xs text-slate-500">實際發聲(總長 {s.duration}s)</div>
        </div>
        <div
          className={`rounded-lg p-2 ${typeof feedback?.score100 === 'number' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-800'}`}
        >
          <div className="text-2xl font-black">
            {typeof feedback?.score100 === 'number' ? feedback.score100 : (s.score100 ?? '—')}
          </div>
          <div className="text-xs text-slate-500">
            新制百分換算{feedback?.sentence_completion ? `·完句 ${feedback.sentence_completion}` : '(按 AI 回饋取得)'}
          </div>
        </div>
      </div>

      <audio controls src={s.audio_path} className="w-full h-9" preload="none" />

      {/* 逐字稿三層 fallback */}
      <div className="rounded-lg bg-slate-50 p-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-semibold text-slate-400">
            逐字稿{s.transcript_source && `(${sourceLabel(s.transcript_source)})`}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button
              className="btn-ghost text-xs"
              onClick={transcribe}
              disabled={transcribing || status.whisper === 'none'}
              title={status.whisper === 'none' ? '本機沒有 faster-whisper,見 README 安裝或改用其他方式' : ''}
            >
              {transcribing ? '轉錄中(首次會下載模型)...' : '🎯 whisper 轉錄'}
            </button>
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                setManual(!manual);
                setManualText(s.transcript);
              }}
            >
              ✍ 手動貼
            </button>
          </div>
        </div>
        {manual ? (
          <div>
            <textarea
              className="input w-full text-sm"
              rows={3}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="把你講的內容打出來或貼上..."
            />
            <button className="btn-primary mt-1.5 text-xs" onClick={saveManual}>
              儲存逐字稿
            </button>
          </div>
        ) : s.transcript ? (
          <div className="text-sm text-slate-700">{s.transcript}</div>
        ) : (
          <div className="text-xs text-slate-400">
            尚無逐字稿。可用 whisper 轉錄/錄音時開即時轉錄/手動貼上。
          </div>
        )}
      </div>

      {/* AI 回饋 */}
      {!feedback ? (
        <div className="flex gap-2">
          <button className="btn-primary" onClick={getFeedback} disabled={!s.transcript || feedbacking}>
            {feedbacking ? 'AI 回饋中(最長 90 秒)...' : '🤖 AI 回饋'}
          </button>
          {onRetry && (
            <button className="btn-secondary" onClick={onRetry} disabled={feedbacking} title="同一題重新錄音並重新計分">
              🔁 重說這題
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {feedback.errors && feedback.errors.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-400">文法修正</span>
                <button className="btn-ghost text-xs" onClick={addErrors} disabled={added}>
                  {added ? '已加入 ✓' : '全部加入錯誤本'}
                </button>
              </div>
              {feedback.errors.map((e, i) => (
                <div key={i} className="text-sm py-0.5">
                  <span className="badge bg-slate-100 text-slate-500 mr-1.5">{e.category}</span>
                  <span className="text-rose-600 line-through">{e.wrong}</span>
                  <span className="mx-1">→</span>
                  <span className="text-emerald-700 font-medium">{e.correct}</span>
                  {e.note && <span className="text-xs text-slate-400 ml-1">({e.note})</span>}
                </div>
              ))}
            </div>
          )}
          {feedback.natural_version && (
            <div className="rounded-lg bg-emerald-50 p-2.5 text-sm text-emerald-800">
              <div className="text-xs font-semibold text-emerald-600 mb-1">更自然的說法</div>
              {feedback.natural_version}
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            {feedback.are_advice && (
              <div className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-800 text-xs">
                <b>ARE 建議:</b>
                {feedback.are_advice}
              </div>
            )}
            {feedback.comment && (
              <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700 text-xs">{feedback.comment}</div>
            )}
          </div>
          {onRetry && (
            <button className="btn-secondary" onClick={onRetry} title="同一題重新錄音並重新計分,舊紀錄保留在歷史頁">
              🔁 重說這題(套用剛剛的修正再挑戰)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function sourceLabel(s: string): string {
  return { whisper: '本地 whisper', webspeech: '瀏覽器即時', manual: '手動' }[s] ?? s;
}

function safeParse(s: string): SpeakingFeedback | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ================= Listen & Repeat 四步字幕法 ================= */

const MISS_REASONS = ['連音', '弱讀', '生字', '語速'] as const;

function Repeat() {
  const [materials, setMaterials] = useState<RepeatMaterial[] | null>(null);
  const [active, setActive] = useState<RepeatMaterial | null>(null);
  const [shadow, setShadow] = useState<RepeatMaterial | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [stats, setStats] = useState<{ totals: Record<string, number>; sessionCount: number } | null>(null);
  const [form, setForm] = useState({ title: '', transcript: '', youtube_url: '' });
  const [genTopic, setGenTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setMaterials(await api.get<RepeatMaterial[]>('/api/repeat/materials'));
    setStats(await api.get('/api/repeat/stats'));
    setStatus(await api.get<SystemStatus>('/api/system/status'));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const m = await api.post<RepeatMaterial>('/api/repeat/generate', { topic: genTopic, count: 8 });
      showToast(`已生成:${m.title}(${m.transcript.split('\n').length} 句)`);
      setGenTopic('');
      await load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setGenerating(false);
    }
  }

  async function create() {
    if (!form.transcript.trim()) {
      showToast('逐字稿必填', 'err');
      return;
    }
    const fd = new FormData();
    fd.append('title', form.title);
    fd.append('transcript', form.transcript);
    fd.append('youtube_url', form.youtube_url);
    const f = fileRef.current?.files?.[0];
    if (f) fd.append('audio', f);
    try {
      await api.upload('/api/repeat/materials', fd);
      setForm({ title: '', transcript: '', youtube_url: '' });
      if (fileRef.current) fileRef.current.value = '';
      showToast('素材已建立');
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  if (active) return <RepeatFlow material={active} onExit={() => { setActive(null); load(); }} />;
  if (shadow && status)
    return <ShadowFlow material={shadow} status={status} onExit={() => { setShadow(null); load(); }} />;

  return (
    <div className="space-y-4">
      {toast}
      <Card title="🎧 L&R 正式考模式(7 句連發·播完 2 秒即複誦·對標正式考節奏)">
        <BankTypePanel qtype="lnr_set" />
      </Card>

      <Card title="🤖 AI 生成跟讀題庫(TTS 朗讀·覆述後自動比對你講不清楚的字)">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="主題(選填,例:餐廳點餐、圖書館、生物課……留空=校園+學術混合)"
            value={genTopic}
            onChange={(e) => setGenTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !generating && generate()}
          />
          <button className="btn-primary" onClick={generate} disabled={generating}>
            {generating ? 'AI 生成中(最長 90 秒)...' : '生成 8 句'}
          </button>
        </div>
        <div className="mt-1.5 text-xs text-slate-400">
          流程:TTS 唸一句(不看字)→ 你覆述錄音 → 轉你的逐字稿 → 紅字標出你漏講/講不清的單字,並給清晰度百分制
        </div>
      </Card>

      <Card title="建跟讀素材(建議:Magoosh 做過的題、TKB 講義音檔)">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            className="input"
            placeholder="素材名稱"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            className="input"
            placeholder="YouTube 連結(選填,外開用)"
            value={form.youtube_url}
            onChange={(e) => setForm({ ...form, youtube_url: e.target.value })}
          />
        </div>
        <textarea
          className="input w-full mb-2"
          rows={3}
          placeholder="貼逐字稿(必填,四步法的字幕)"
          value={form.transcript}
          onChange={(e) => setForm({ ...form, transcript: e.target.value })}
        />
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.webm,.wav" className="text-sm" />
          <button className="btn-primary ml-auto" onClick={create}>
            建立素材
          </button>
        </div>
      </Card>

      {stats && stats.sessionCount > 0 && (
        <Card title={`漏聽原因統計(${stats.sessionCount} 次跟讀·聽力筆記自動化)`}>
          <div className="grid grid-cols-4 gap-2 text-center">
            {MISS_REASONS.map((r) => (
              <div key={r} className="rounded-lg bg-slate-50 p-2">
                <div className="text-2xl font-black text-slate-800">{stats.totals[r] ?? 0}</div>
                <div className="text-xs text-slate-500">{r}</div>
              </div>
            ))}
          </div>
          {Object.entries(stats.totals).some(([, v]) => v > 0) && (
            <div className="mt-2 text-xs text-slate-500">
              最多的是「
              {Object.entries(stats.totals).sort((a, b) => b[1] - a[1])[0][0]}
              」→ 這就是你的聽力專攻點
            </div>
          )}
        </Card>
      )}

      <Card title={`素材庫(${materials?.length ?? 0})`}>
        {!materials ? (
          <Spinner />
        ) : materials.length === 0 ? (
          <EmptyState text="還沒有素材。上傳一段做過的聽力題音檔+逐字稿開始四步跟讀" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {materials.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`badge shrink-0 ${m.kind === 'tts' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}
                >
                  {m.kind === 'tts' ? 'TTS' : '音檔'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">{m.title}</div>
                  <div className="text-xs text-slate-400 truncate">
                    {m.transcript.split('\n').filter((s) => s.trim()).length} 句·{m.transcript.slice(0, 60)}...
                  </div>
                </div>
                {m.youtube_url && (
                  <a href={m.youtube_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
                    YT ↗
                  </a>
                )}
                {m.kind === 'tts' ? (
                  <button className="btn-primary" onClick={() => setShadow(m)}>
                    跟讀評分
                  </button>
                ) : (
                  <>
                    <button className="btn-primary" onClick={() => setActive(m)}>
                      四步跟讀
                    </button>
                    <button className="btn-secondary" onClick={() => setShadow(m)} title="逐句覆述,自動比對講不清楚的字">
                      跟讀評分
                    </button>
                  </>
                )}
                <button
                  className="btn-ghost text-xs text-rose-500"
                  onClick={async () => {
                    if (confirm('刪除素材?')) {
                      await api.del(`/api/repeat/materials/${m.id}`);
                      load();
                    }
                  }}
                >
                  刪除
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RepeatFlow({ material, onExit }: { material: RepeatMaterial; onExit: () => void }) {
  const [step, setStep] = useState(1);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [reasons, setReasons] = useState<Record<string, number>>({ 連音: 0, 弱讀: 0, 生字: 0, 語速: 0 });
  const [repeatCount, setRepeatCount] = useState(0);
  const [myRecording, setMyRecording] = useState('');
  const recorder = useRecorder();
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.post<{ id: number }>('/api/repeat/sessions', { material_id: material.id }).then((r) => setSessionId(r.id));
  }, [material.id]);

  const patch = useCallback(
    (body: Record<string, unknown>) => {
      if (sessionId) api.patch(`/api/repeat/sessions/${sessionId}`, body).catch(() => {});
    },
    [sessionId]
  );

  function record() {
    recorder.start({
      countdownSec: 0,
      maxSeconds: 90,
      onStop: async (blob) => {
        if (!sessionId) return;
        const fd = new FormData();
        fd.append('audio', blob, 'repeat.webm');
        const r = await api.upload<{ recording_path: string }>(`/api/repeat/sessions/${sessionId}/recording`, fd);
        setMyRecording(r.recording_path);
        showToast('錄音已儲存');
      },
    });
  }

  const STEPS = [
    '① 盲聽:不看字幕聽 1 句(8–12 秒),試著複誦並錄音',
    '② 對照:顯示字幕,勾你漏聽的原因',
    '③ 跟讀:關字幕跟讀 3 次(模仿重音節奏與語調)',
    '④ A/B 對比:原音 vs 自己的錄音,挑 1 個最不像的音專攻',
  ];

  return (
    <div className="space-y-3">
      {toast}
      <div className="flex items-center gap-2">
        <button className="btn-secondary" onClick={onExit}>
          ← 結束
        </button>
        <div className="font-semibold text-slate-800">{material.title}</div>
        <div className="ml-auto flex gap-1">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => {
                setStep(n);
                patch({ step: n });
              }}
              className={`h-8 w-8 rounded-full text-sm font-bold ${
                step === n ? 'bg-brand-600 text-white' : step > n ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <div className="text-sm font-semibold text-slate-700 mb-3">{STEPS[step - 1]}</div>

        {/* 原音播放器(所有步驟可用) */}
        {material.audio_path ? (
          <audio controls src={material.audio_path} className="w-full h-9 mb-3" />
        ) : (
          <div className="mb-3 text-xs text-amber-600">
            此素材沒有音檔,請開
            {material.youtube_url ? (
              <a className="underline" href={material.youtube_url} target="_blank" rel="noreferrer">
                YouTube 原片
              </a>
            ) : (
              'YouTube 原片'
            )}
            對照播放
          </div>
        )}

        {/* 字幕:步驟 2 顯示,其餘遮蔽 */}
        {step === 2 || step === 4 ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap mb-3">
            {material.transcript}
          </div>
        ) : (
          <div className="rounded-lg bg-slate-800 p-3 text-center text-xs text-slate-400 mb-3 select-none">
            (字幕已隱藏——{step === 1 ? '先盲聽' : '關字幕跟讀'})
          </div>
        )}

        {/* 步驟內容 */}
        {step === 1 && (
          <div className="flex items-center gap-2">
            {recorder.state === 'recording' ? (
              <button className="btn-danger" onClick={recorder.stop}>
                ■ 停止({recorder.elapsed.toFixed(0)}s)
              </button>
            ) : (
              <button className="btn-primary" onClick={record}>
                🎙 錄複誦
              </button>
            )}
            {myRecording && <audio controls src={myRecording} className="h-9" />}
            <button className="btn-secondary ml-auto" onClick={() => { setStep(2); patch({ step: 2 }); }}>
              下一步 →
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="text-xs text-slate-500 mb-2">勾選漏聽原因(可多次點擊累計):</div>
            <div className="flex gap-2 mb-3">
              {MISS_REASONS.map((r) => (
                <button
                  key={r}
                  className="btn-secondary"
                  onClick={() => {
                    const next = { ...reasons, [r]: (reasons[r] ?? 0) + 1 };
                    setReasons(next);
                    patch({ reasons: next });
                  }}
                >
                  {r} ×{reasons[r] ?? 0}
                </button>
              ))}
            </div>
            <button className="btn-secondary" onClick={() => { setStep(3); patch({ step: 3 }); }}>
              下一步 →
            </button>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="text-sm text-slate-600">跟讀次數:</span>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setRepeatCount(n)}
                  className={`h-9 w-9 rounded-full font-bold ${repeatCount >= n ? 'bg-emerald-500 text-white' : 'bg-slate-200'}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {recorder.state === 'recording' ? (
                <button className="btn-danger" onClick={recorder.stop}>
                  ■ 停止({recorder.elapsed.toFixed(0)}s)
                </button>
              ) : (
                <button className="btn-primary" onClick={record}>
                  🎙 錄最後一次跟讀(步驟 4 對比用)
                </button>
              )}
              <button
                className="btn-secondary ml-auto"
                disabled={repeatCount < 3}
                title={repeatCount < 3 ? '先跟讀 3 次' : ''}
                onClick={() => { setStep(4); patch({ step: 4 }); }}
              >
                下一步 →
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-lg border border-slate-200 p-2.5">
                <div className="text-xs font-semibold text-slate-400 mb-1">原音</div>
                {material.audio_path ? (
                  <audio controls src={material.audio_path} className="w-full h-9" />
                ) : (
                  <div className="text-xs text-slate-400">(用 YouTube 原片)</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5">
                <div className="text-xs font-semibold text-slate-400 mb-1">你的錄音</div>
                {myRecording ? (
                  <audio controls src={myRecording} className="w-full h-9" />
                ) : (
                  <div className="text-xs text-slate-400">(回步驟 3 錄一次)</div>
                )}
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={() => {
                patch({ done: true, reasons });
                showToast('四步完成!漏聽原因已計入統計');
                onExit();
              }}
            >
              ✓ 完成這次跟讀
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================= 跟讀評分(TTS 播 → 覆述 → 標出講不清楚的字) ================= */

interface ShadowOp {
  type: 'equal' | 'sub' | 'del' | 'ins';
  ref?: string;
  hyp?: string;
}

interface ShadowResult {
  accuracy: number;
  unclear: { word: string; heard: string }[];
  ops: ShadowOp[];
  transcript: string;
}

/** 把素材拆成句子:優先換行,整段落則按句號拆 */
function splitSentences(transcript: string): string[] {
  const lines = transcript.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return transcript
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ShadowFlow({
  material,
  status,
  onExit,
}: {
  material: RepeatMaterial;
  status: SystemStatus;
  onExit: () => void;
}) {
  const sentences = splitSentences(material.transcript);
  const [idx, setIdx] = useState(0);
  const [rate, setRate] = useState(0.9);
  const [phase, setPhase] = useState<'ready' | 'recording' | 'processing' | 'result'>('ready');
  const [result, setResult] = useState<ShadowResult | null>(null);
  const [played, setPlayed] = useState(false);
  const [history, setHistory] = useState<{ sentence: string; accuracy: number; unclear: string[] }[]>([]);
  const recorder = useRecorder();
  const speech = useWebSpeech();
  const [toast, showToast] = useToast();

  const useWs = status.whisper === 'none' && webSpeechSupported();
  const canTranscribe = status.whisper !== 'none' || webSpeechSupported();
  const sentence = sentences[idx];
  const finished = history.length >= sentences.length;

  function play(text: string) {
    speakEn(text, rate, undefined, pickVoice('any', hashSeed(String(material.id))));
    setPlayed(true);
  }

  useEffect(() => () => speechSynthesis.cancel(), []);

  function startRecord() {
    if (useWs) speech.start();
    setPhase('recording');
    recorder.start({ countdownSec: 0, maxSeconds: 30, onStop: (blob) => void handleStop(blob) });
  }

  async function handleStop(blob: Blob) {
    setPhase('processing');
    const wsText = useWs ? speech.stop() : '';
    try {
      const form = new FormData();
      form.append('mode', 'repeat');
      form.append('question', sentence);
      form.append('audio', blob, 'shadow.webm');
      const up = await api.upload<{ session: SpeakingSession }>('/api/speaking/upload', form);
      const sid = up.session.id;
      if (wsText) {
        await api.patch(`/api/speaking/sessions/${sid}`, { transcript: wsText, transcript_source: 'webspeech' });
      } else {
        await api.post(`/api/speaking/sessions/${sid}/transcribe`);
      }
      const r = await api.post<ShadowResult>('/api/repeat/shadow-score', { session_id: sid });
      setResult(r);
      setPhase('result');
    } catch (e) {
      showToast(`比對失敗:${(e as Error).message}`, 'err');
      setPhase('ready');
    }
  }

  function commitAndNext() {
    if (result) {
      setHistory((h) => [
        ...h,
        { sentence, accuracy: result.accuracy, unclear: result.unclear.map((u) => u.word) },
      ]);
    }
    setResult(null);
    setPlayed(false);
    setPhase('ready');
    if (idx < sentences.length - 1) setIdx(idx + 1);
  }

  const allUnclear = [...new Set(history.flatMap((h) => h.unclear))];
  const avgAcc = history.length > 0 ? Math.round(history.reduce((s, h) => s + h.accuracy, 0) / history.length) : 0;

  return (
    <div className="space-y-3">
      {toast}
      <div className="flex items-center gap-2">
        <button className="btn-secondary" onClick={onExit}>
          ← 結束
        </button>
        <div className="font-semibold text-slate-800">跟讀評分|{material.title}</div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-200 p-1">
            {[0.75, 0.9, 1.1].map((r) => (
              <button
                key={r}
                className={`rounded-md px-2.5 py-0.5 text-xs ${rate === r ? 'bg-white shadow font-medium' : 'text-slate-600'}`}
                onClick={() => setRate(r)}
              >
                {r}x
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            {Math.min(history.length + 1, sentences.length)}/{sentences.length} 句
          </span>
        </div>
      </div>

      {!canTranscribe && (
        <div className="card border-rose-300 bg-rose-50 text-sm text-rose-700">
          這個模式需要逐字稿:本機沒有 faster-whisper,且此瀏覽器不支援即時轉錄。請改用 Chrome 或安裝 whisper(見 README)。
        </div>
      )}
      {recorder.error && <div className="card border-rose-300 bg-rose-50 text-sm text-rose-700">{recorder.error}</div>}

      {/* 完成總結 */}
      {finished ? (
        <Card title="🎉 這組跟讀完成">
          <div className="flex items-center gap-6 mb-3">
            <div>
              <div className="text-4xl font-black text-emerald-600">{avgAcc}<span className="text-base text-slate-400">/100</span></div>
              <div className="text-xs text-slate-500">平均清晰度</div>
            </div>
            <div className="flex-1">
              {allUnclear.length > 0 ? (
                <>
                  <div className="text-xs font-semibold text-slate-500 mb-1">這輪講不清楚的字(點喇叭跟讀單字):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {allUnclear.map((w) => (
                      <button key={w} className="badge bg-rose-100 text-rose-700 hover:bg-rose-200" onClick={() => play(w)}>
                        🔊 {w}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-sm text-emerald-600">全部講清楚了,沒有漏字!</div>
              )}
            </div>
          </div>
          <table className="w-full text-sm mb-3">
            <tbody className="divide-y divide-slate-100">
              {history.map((h, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2 text-xs text-slate-400">{i + 1}</td>
                  <td className="py-1.5 pr-2">{h.sentence}</td>
                  <td className={`py-1.5 font-bold ${h.accuracy >= 80 ? 'text-emerald-600' : h.accuracy >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {h.accuracy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                setHistory([]);
                setIdx(0);
                setResult(null);
                setPlayed(false);
                setPhase('ready');
              }}
            >
              🔁 再練一輪
            </button>
            <button className="btn-secondary" onClick={onExit}>
              結束(成績已記錄在口說歷史)
            </button>
          </div>
        </Card>
      ) : (
        <Card>
          {/* 句子:未出結果前隱藏(盲聽) */}
          {phase !== 'result' ? (
            <div className="rounded-lg bg-slate-800 p-4 text-center text-sm text-slate-400 select-none mb-3">
              (第 {idx + 1} 句已隱藏——先聽再覆述)
            </div>
          ) : (
            result && (
              <div className="mb-3">
                <div className="rounded-lg bg-slate-50 p-3 text-lg leading-relaxed">
                  {result.ops
                    .filter((o) => o.type !== 'ins')
                    .map((o, i) =>
                      o.type === 'equal' ? (
                        <span key={i} className="text-slate-700">{o.ref} </span>
                      ) : (
                        <b key={i} className="text-rose-600 underline decoration-2 decoration-rose-400">
                          {o.ref}{' '}
                        </b>
                      )
                    )}
                  <span
                    className={`ml-2 badge ${result.accuracy >= 80 ? 'bg-emerald-100 text-emerald-700' : result.accuracy >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}
                  >
                    清晰度 {result.accuracy}/100
                  </span>
                </div>
                <div className="mt-2 rounded-lg bg-slate-100 p-2.5 text-sm text-slate-600">
                  <span className="text-xs font-semibold text-slate-400 mr-1.5">你說的(逐字稿):</span>
                  {result.transcript || '(沒聽到內容)'}
                </div>
                {result.unclear.length > 0 && (
                  <div className="mt-2 text-xs text-slate-500">
                    講不清楚:
                    {result.unclear.map((u, i) => (
                      <span key={i} className="ml-1.5">
                        <b className="text-rose-600">{u.word}</b>
                        {u.heard && <span className="text-slate-400">(聽成 {u.heard})</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {/* 操作列 */}
          <div className="flex items-center justify-center gap-2 py-2">
            {phase === 'ready' && (
              <>
                <button className="btn-primary text-base px-5 py-2" onClick={() => play(sentence)}>
                  🔊 播放第 {idx + 1} 句
                </button>
                <button
                  className="btn-danger text-base px-5 py-2"
                  onClick={startRecord}
                  disabled={!played || !canTranscribe}
                  title={played ? '' : '先聽一次再覆述'}
                >
                  🎙 開始覆述
                </button>
              </>
            )}
            {phase === 'recording' && (
              <div className="text-center">
                <div className="mb-2 flex items-center justify-center gap-2 text-rose-600 font-bold">
                  <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-rose-600" />
                  覆述中 {recorder.elapsed.toFixed(1)}s(最長 30s)
                </div>
                <button className="btn-danger" onClick={recorder.stop}>
                  ■ 講完了
                </button>
              </div>
            )}
            {phase === 'processing' && (
              <div className="text-sm text-slate-500 py-2">
                轉錄比對中{useWs ? '' : '(whisper)'}...
              </div>
            )}
            {phase === 'result' && (
              <>
                <button className="btn-secondary" onClick={() => play(sentence)}>
                  🔊 重播原句
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setResult(null);
                    setPhase('ready');
                  }}
                >
                  🔁 重說這句
                </button>
                <button className="btn-primary" onClick={commitAndNext}>
                  {idx < sentences.length - 1 ? '下一句 →' : '完成 ✓'}
                </button>
              </>
            )}
          </div>
          <div className="text-center text-xs text-slate-400">
            逐字稿來源:{useWs ? '瀏覽器即時轉錄' : '本地 whisper'}·清晰度與逐字稿會存入口說歷史(mode=repeat)
          </div>
        </Card>
      )}
    </div>
  );
}

/* ================= 歷史·趨勢·Baseline A/B ================= */

function History() {
  const [sessions, setSessions] = useState<SpeakingSession[] | null>(null);
  const [trend, setTrend] = useState<{ date: string; dead_air: number; voiced: number; n: number }[]>([]);
  const [compareA, setCompareA] = useState<SpeakingSession | null>(null);
  const [compareB, setCompareB] = useState<SpeakingSession | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    const [ss, tr] = await Promise.all([
      api.get<SpeakingSession[]>('/api/speaking/sessions?mode=all&limit=200'),
      api.get<{ date: string; dead_air: number; voiced: number; n: number }[]>('/api/speaking/trend'),
    ]);
    setSessions(ss);
    setTrend(tr);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function uploadBaseline() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      showToast('請先選擇音檔(webm/m4a/mp3)', 'err');
      return;
    }
    const fd = new FormData();
    fd.append('mode', 'baseline');
    fd.append('question', 'Day 0 基線錄音');
    fd.append('is_baseline', '1');
    fd.append('audio', f, f.name);
    try {
      await api.upload('/api/speaking/upload', fd);
      showToast('基線錄音已匯入(自動算了三指標)');
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  if (!sessions) return <Spinner />;

  const baselines = sessions.filter((s) => s.is_baseline === 1);
  const chartData = trend.map((t) => ({
    date: t.date.slice(5),
    死寂次數: Math.round(t.dead_air * 10) / 10,
    發聲秒數: Math.round(t.voiced * 10) / 10,
  }));

  return (
    <div className="space-y-4">
      {toast}
      <Card title="指標趨勢(Interview 每日平均)">
        {chartData.length === 0 ? (
          <EmptyState text="還沒有 Interview 練習紀錄" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="l" type="monotone" dataKey="死寂次數" stroke="#e11d48" strokeWidth={2} />
              <Line yAxisId="r" type="monotone" dataKey="發聲秒數" stroke="#059669" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div className="text-xs text-slate-400 mt-1">目標:死寂 → 0,發聲秒數 → ≥35s</div>
      </Card>

      <Card title="Day 0 基線與 A/B 回聽(第 4/8 週對比用)">
        <div className="flex items-center gap-2 mb-3">
          <input ref={fileRef} type="file" accept=".webm,.m4a,.mp3,.wav,audio/*" className="text-sm" />
          <button className="btn-secondary" onClick={uploadBaseline}>
            匯入基線錄音
          </button>
          <span className="text-xs text-slate-400">已有 {baselines.length} 段基線</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label mb-1">A(通常選基線)</div>
            <select
              className="input w-full"
              value={compareA?.id ?? ''}
              onChange={(e) => setCompareA(sessions.find((s) => s.id === Number(e.target.value)) ?? null)}
            >
              <option value="">選擇錄音...</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.is_baseline ? '⭐基線 ' : ''}
                  {s.date} #{s.id} {s.question.slice(0, 30)}
                </option>
              ))}
            </select>
            {compareA && <audio controls src={compareA.audio_path} className="w-full h-9 mt-2" />}
          </div>
          <div>
            <div className="label mb-1">B(通常選最近練習)</div>
            <select
              className="input w-full"
              value={compareB?.id ?? ''}
              onChange={(e) => setCompareB(sessions.find((s) => s.id === Number(e.target.value)) ?? null)}
            >
              <option value="">選擇錄音...</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.is_baseline ? '⭐基線 ' : ''}
                  {s.date} #{s.id} {s.question.slice(0, 30)}
                </option>
              ))}
            </select>
            {compareB && <audio controls src={compareB.audio_path} className="w-full h-9 mt-2" />}
          </div>
        </div>
        {compareA && compareB && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-center text-sm">
            <div className="rounded-lg bg-slate-50 p-2">
              死寂 {compareA.dead_air_count} 次·發聲 {compareA.voiced_seconds}s
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              死寂 {compareB.dead_air_count} 次·發聲 {compareB.voiced_seconds}s
            </div>
          </div>
        )}
      </Card>

      <Card title={`全部錄音(${sessions.length})`}>
        {sessions.length === 0 ? (
          <EmptyState text="還沒有錄音" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-2">日期</th>
                <th className="py-2 pr-2">模式</th>
                <th className="py-2 pr-2">題目</th>
                <th className="py-2 pr-2">死寂</th>
                <th className="py-2 pr-2">發聲</th>
                <th className="py-2 pr-2">百分</th>
                <th className="py-2 pr-2">逐字稿</th>
                <th className="py-2 pr-2">回饋</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-2 whitespace-nowrap">{s.date.slice(5)}</td>
                  <td className="py-2 pr-2">
                    {s.is_baseline === 1 ? (
                      <span className="badge bg-amber-100 text-amber-700">基線</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-500">{s.mode}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 max-w-[220px] truncate">{s.question}</td>
                  <td className="py-2 pr-2">{s.dead_air_count}</td>
                  <td className="py-2 pr-2">{s.voiced_seconds}s</td>
                  <td className="py-2 pr-2 font-medium">{s.score100 ?? ''}</td>
                  <td className="py-2 pr-2">{s.transcript ? '✓' : ''}</td>
                  <td className="py-2 pr-2">{s.feedback ? '✓' : ''}</td>
                  <td className="py-2 text-right">
                    <button
                      className="btn-ghost text-xs text-rose-500"
                      onClick={async () => {
                        if (confirm('刪除這段錄音(含音檔)?')) {
                          await api.del(`/api/speaking/sessions/${s.id}`);
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
