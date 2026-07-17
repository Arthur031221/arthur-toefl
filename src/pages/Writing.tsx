import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { Card, EmptyState, PageTitle, Spinner, useToast } from '../components/ui';
import { BankTypePanel } from '../practice/BankPage';
import type { GradeResult, WritingPrompt, WritingSession } from '../types';

const KIND_INFO = {
  email: { label: 'Write an Email', seconds: 7 * 60, wordHint: '100–150 字為佳' },
  discussion: { label: 'Academic Discussion', seconds: 10 * 60, wordHint: '至少 100 字(不足標紅)' },
} as const;

type Kind = keyof typeof KIND_INFO;

interface PartsLibrary {
  rule: string;
  email: string[];
  discussion: string[];
}

const CHECKLIST = ['① 可數名詞 -s/冠詞', '② 動詞時態/三單', '③ 拼寫'];

export default function Writing() {
  const [tab, setTab] = useState<'practice' | 'bs' | 'history'>('practice');
  return (
    <div>
      <PageTitle title="寫作訓練室" sub="Build a Sentence 60 秒重組·Email 7 分鐘/Discussion 10 分鐘·時間到自動鎖定·送出前必過三項自檢" />
      <div className="mb-4 flex gap-2">
        <button className={tab === 'practice' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('practice')}>
          Email/Discussion
        </button>
        <button className={tab === 'bs' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('bs')}>
          組織句子(Build a Sentence)
        </button>
        <button className={tab === 'history' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('history')}>
          歷史與趨勢
        </button>
      </div>
      {tab === 'practice' && <Practice />}
      {tab === 'bs' && <BankTypePanel qtype="build_sentence" />}
      {tab === 'history' && <History />}
    </div>
  );
}

/* ---------------- 練習流程 ---------------- */

function Practice() {
  const [stage, setStage] = useState<'setup' | 'writing' | 'result'>('setup');
  const [kind, setKind] = useState<Kind>('email');
  const [prompts, setPrompts] = useState<WritingPrompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<WritingPrompt | null>(null);
  const [customText, setCustomText] = useState('');
  const [source, setSource] = useState<'bank' | 'custom'>('bank');
  const [generating, setGenerating] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [session, setSession] = useState<WritingSession | null>(null);
  const [toast, showToast] = useToast();

  const loadPrompts = useCallback(async (k: Kind) => {
    const rows = await api.get<WritingPrompt[]>(`/api/writing/prompts?kind=${k}`);
    setPrompts(rows);
    setSelectedPrompt((prev) => rows.find((r) => r.id === prev?.id) ?? rows[0] ?? null);
  }, []);

  useEffect(() => {
    loadPrompts(kind);
  }, [kind, loadPrompts]);

  async function generate() {
    setGenerating(true);
    try {
      const p = await api.post<WritingPrompt>('/api/writing/generate', { kind });
      await loadPrompts(kind);
      setSelectedPrompt(p);
      setSource('bank');
      showToast(`AI 出題完成:${p.title}(不耗 Flex)`);
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setGenerating(false);
    }
  }

  async function start() {
    const promptText = source === 'custom' ? customText.trim() : (selectedPrompt?.prompt ?? '');
    if (!promptText) {
      showToast('請先選題或貼上題目', 'err');
      return;
    }
    const r = await api.post<{ id: number }>('/api/writing/sessions', {
      kind,
      prompt_id: source === 'custom' ? undefined : selectedPrompt?.id,
      prompt_text: promptText,
    });
    setSessionId(r.id);
    setStage('writing');
  }

  if (stage === 'writing' && sessionId) {
    return (
      <Editor
        kind={kind}
        sessionId={sessionId}
        promptText={source === 'custom' ? customText : (selectedPrompt?.prompt ?? '')}
        onDone={(parsed, s) => {
          setResult(parsed);
          setSession(s);
          setStage('result');
        }}
        onBack={() => setStage('setup')}
      />
    );
  }

  if (stage === 'result' && result && session) {
    return (
      <ResultView
        result={result}
        session={session}
        onAgain={() => {
          setResult(null);
          setSession(null);
          setSessionId(null);
          setStage('setup');
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {toast}
      <Card title="1|選擇題型">
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(KIND_INFO) as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                kind === k ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="font-bold text-slate-800">{KIND_INFO[k].label}</div>
              <div className="text-xs text-slate-500 mt-1">
                計時 {KIND_INFO[k].seconds / 60}:00·{KIND_INFO[k].wordHint}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="2|題目來源">
        <div className="flex gap-2 mb-3">
          <button className={source === 'bank' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSource('bank')}>
            內建題庫
          </button>
          <button className="btn-secondary" onClick={generate} disabled={generating}>
            {generating ? 'AI 出題中(最長 90 秒)...' : '🤖 AI 出題(不耗 Flex)'}
          </button>
          <button className={source === 'custom' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSource('custom')}>
            自貼題目
          </button>
        </div>
        {source === 'custom' ? (
          <textarea
            className="input w-full"
            rows={6}
            placeholder="貼上完整題目(例如從 TestReady 抄下的題)"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
          />
        ) : (
          <>
            <select
              className="input w-full mb-2"
              value={selectedPrompt?.id ?? ''}
              onChange={(e) => setSelectedPrompt(prompts.find((p) => p.id === Number(e.target.value)) ?? null)}
            >
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.source === 'ai' ? '🤖 ' : ''}
                  {p.title}
                </option>
              ))}
            </select>
            {selectedPrompt && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm whitespace-pre-wrap text-slate-700 max-h-56 overflow-y-auto">
                {selectedPrompt.prompt}
              </div>
            )}
          </>
        )}
      </Card>

      <button className="btn-primary text-base px-6 py-2.5" onClick={start}>
        ▶ 開始作答(計時 {KIND_INFO[kind].seconds / 60} 分鐘)
      </button>
    </div>
  );
}

/* ---------------- 計時編輯器 ---------------- */

function Editor({
  kind,
  sessionId,
  promptText,
  onDone,
  onBack,
}: {
  kind: Kind;
  sessionId: number;
  promptText: string;
  onDone: (r: GradeResult, s: WritingSession) => void;
  onBack: () => void;
}) {
  const total = KIND_INFO[kind].seconds;
  const [secondsLeft, setSecondsLeft] = useState(total);
  const [locked, setLocked] = useState(false);
  const [overtime, setOvertime] = useState(false);
  const [answer, setAnswer] = useState('');
  const [checks, setChecks] = useState<boolean[]>([false, false, false]);
  const [grading, setGrading] = useState(false);
  const [parts, setParts] = useState<PartsLibrary | null>(null);
  const [toast, showToast] = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef('');
  const dirtyRef = useRef(false);
  const secondsLeftRef = useRef(total);
  const overtimeRef = useRef(false);
  answerRef.current = answer;
  secondsLeftRef.current = secondsLeft;
  overtimeRef.current = overtime;

  useEffect(() => {
    api.get<PartsLibrary>('/api/writing/parts').then(setParts).catch(() => setParts(null));
  }, []);

  // 倒數計時,時間到鎖定
  useEffect(() => {
    if (locked) return;
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
  }, [locked]);

  // 自動保存(每 4 秒 + 卸載時);AI/網路失敗也不丟作答
  const save = useCallback(
    async (extra?: Record<string, unknown>) => {
      await api
        .patch(`/api/writing/sessions/${sessionId}`, {
          answer: answerRef.current,
          seconds_used: total - secondsLeftRef.current,
          overtime: overtimeRef.current,
          ...extra,
        })
        .catch(() => {});
      dirtyRef.current = false;
    },
    [sessionId, total]
  );

  useEffect(() => {
    const t = setInterval(() => {
      if (dirtyRef.current) save();
    }, 4000);
    return () => {
      clearInterval(t);
      save();
    };
  }, [save]);

  const words = (answer.match(/[A-Za-z0-9'’-]+/g) || []).length;
  const wordWarn = kind === 'discussion' && words < 100;
  const allChecked = checks.every(Boolean);

  function insertPart(text: string) {
    const ta = textareaRef.current;
    if (!ta || (locked && !overtime)) return;
    const start = ta.selectionStart ?? answer.length;
    const end = ta.selectionEnd ?? answer.length;
    const next = answer.slice(0, start) + text + answer.slice(end);
    setAnswer(next);
    dirtyRef.current = true;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    });
  }

  async function grade() {
    setGrading(true);
    try {
      await save({ status: 'submitted' });
      const r = await api.post<{ parsed: GradeResult | null; raw: string }>(
        `/api/writing/sessions/${sessionId}/grade`
      );
      const s = await api.get<WritingSession>(`/api/writing/sessions/${sessionId}`);
      onDone(r.parsed ?? { comment: r.raw }, s);
    } catch (e) {
      showToast(`批改失敗:${(e as Error).message}(作答已保存,可重試)`, 'err');
    } finally {
      setGrading(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const editable = !locked || overtime;
  const partsList = parts ? (kind === 'email' ? parts.email : parts.discussion) : [];

  return (
    <div className="space-y-3">
      {toast}
      {/* 計時列 */}
      <div
        className={`card flex items-center justify-between py-3 ${
          secondsLeft === 0 ? 'bg-rose-50 border-rose-300' : secondsLeft < 60 ? 'bg-amber-50 border-amber-300' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`text-3xl font-black tabular-nums ${
              secondsLeft === 0 ? 'text-rose-600' : secondsLeft < 60 ? 'text-amber-600' : 'text-slate-800'
            }`}
          >
            {mm}:{ss}
          </span>
          <div className="h-2 w-40 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${(secondsLeft / total) * 100}%` }} />
          </div>
          {overtime && <span className="badge bg-rose-100 text-rose-600">已超時(紀錄將標記)</span>}
        </div>
        <div className={`text-sm font-medium ${wordWarn ? 'text-rose-600' : 'text-slate-600'}`}>
          {words} 字{wordWarn && '(未達 100)'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* 題目 + 編輯器 */}
        <div className="col-span-2 space-y-3">
          <div className="card max-h-44 overflow-y-auto">
            <div className="text-xs font-semibold text-slate-400 mb-1">題目</div>
            <div className="whitespace-pre-wrap text-sm text-slate-700">{promptText}</div>
          </div>
          <div className="relative">
            <textarea
              ref={textareaRef}
              className="input w-full font-mono text-sm leading-relaxed"
              rows={16}
              placeholder="在這裡作答(自動保存)..."
              value={answer}
              readOnly={!editable}
              onChange={(e) => {
                setAnswer(e.target.value);
                dirtyRef.current = true;
              }}
            />
            {locked && !overtime && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-slate-900/70 text-white">
                <div className="text-2xl font-bold">⏰ 時間到,編輯已鎖定</div>
                <button
                  className="btn bg-white text-slate-800 hover:bg-slate-100"
                  onClick={() => {
                    setOvertime(true);
                    dirtyRef.current = true;
                  }}
                >
                  解鎖繼續寫(標記超時)
                </button>
                <div className="text-xs text-slate-300">或完成右側三項自檢後直接送批改</div>
              </div>
            )}
          </div>
        </div>

        {/* 側欄:零件庫 + 自檢 */}
        <div className="space-y-3">
          <div className="card">
            <div className="text-xs font-semibold text-slate-400 mb-2">零件庫(點擊插入·一字不改)</div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {partsList.map((p, i) => (
                <button
                  key={i}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left text-xs text-slate-600 hover:border-brand-400 hover:bg-brand-50"
                  onClick={() => insertPart(p + ' ')}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="text-xs font-semibold text-slate-400 mb-2">三項自檢(逐項勾過才能送批改)</div>
            {CHECKLIST.map((c, i) => (
              <label key={c} className="flex items-center gap-2 py-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={checks[i]}
                  onChange={(e) => setChecks((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                {c}
              </label>
            ))}
            <button
              className="btn-primary w-full mt-2"
              disabled={!allChecked || grading || words === 0}
              title={allChecked ? '' : '請先完成三項自檢'}
              onClick={grade}
            >
              {grading ? 'AI 批改中(最長 90 秒)...' : '送出 AI 批改'}
            </button>
            <button className="btn-secondary w-full mt-2" onClick={onBack}>
              返回(草稿已保存)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 批改結果 ---------------- */

export function ResultView({
  result,
  session,
  onAgain,
}: {
  result: GradeResult;
  session: WritingSession;
  onAgain?: () => void;
}) {
  const [added, setAdded] = useState(false);
  const [flex, setFlex] = useState(session.used_flex === 1);
  const [toast, showToast] = useToast();

  async function addAllErrors() {
    if (!result.errors?.length) return;
    const r = await api.post<{ added: number }>('/api/errors/bulk', {
      errors: result.errors,
      source: session.kind === 'email' ? '寫作批改(Email)' : '寫作批改(Discussion)',
    });
    setAdded(true);
    showToast(`已加入錯誤本 ${r.added} 筆`);
  }

  async function toggleFlex() {
    try {
      const r = await api.post<{ used_flex: number; remaining: number; lowWarning: boolean }>(
        `/api/writing/sessions/${session.id}/flex`
      );
      setFlex(r.used_flex === 1);
      showToast(
        r.used_flex === 1
          ? `已標記消耗 Flex,剩 ${r.remaining} 題${r.lowWarning ? '(已達保留線!)' : ''}`
          : 'Flex 標記已取消',
        r.lowWarning && r.used_flex === 1 ? 'err' : 'ok'
      );
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  return (
    <div className="space-y-4">
      {toast}
      <div className="card flex items-center gap-4">
        <div>
          <div className="text-xs text-slate-400">AI 評分(rubric)</div>
          <div className="text-5xl font-black text-brand-600">
            {result.score ?? '—'}
            <span className="text-lg text-slate-400 font-bold">/5</span>
          </div>
        </div>
        <div className="border-l border-slate-200 pl-4">
          <div className="text-xs text-slate-400">新制百分換算</div>
          <div className="text-5xl font-black text-emerald-600">
            {result.score100 ?? session.score100 ?? '—'}
            <span className="text-lg text-slate-400 font-bold">/100</span>
          </div>
        </div>
        <div className="flex-1 text-sm text-slate-600">
          {result.word_count !== undefined && <div>字數:{result.word_count}</div>}
          <div>
            用時:{Math.floor(session.seconds_used / 60)}:{String(session.seconds_used % 60).padStart(2, '0')}
            {session.overtime === 1 && <span className="ml-1 text-rose-500">(超時)</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button className={flex ? 'btn-danger' : 'btn-secondary'} onClick={toggleFlex}>
            {flex ? '✓ 已消耗 Flex(點擊取消)' : '這題消耗了 Flex 配額'}
          </button>
          {onAgain && (
            <button className="btn-primary" onClick={onAgain}>
              再練一題
            </button>
          )}
        </div>
      </div>

      {result.task_check && result.task_check.length > 0 && (
        <Card title="任務點檢查">
          <div className="flex flex-wrap gap-2">
            {result.task_check.map((t, i) => (
              <span
                key={i}
                className={`badge ${t.done ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}
              >
                {t.done ? '✓' : '✗'} {t.task}
              </span>
            ))}
          </div>
        </Card>
      )}

      {result.errors && result.errors.length > 0 && (
        <Card
          title={`錯誤清單(${result.errors.length})`}
          right={
            <button className="btn-primary" onClick={addAllErrors} disabled={added}>
              {added ? '已加入 ✓' : '一鍵全部加入錯誤本'}
            </button>
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-2">分類</th>
                <th className="py-1.5 pr-2">錯誤</th>
                <th className="py-1.5 pr-2">正確</th>
                <th className="py-1.5">說明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.errors.map((e, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">
                    <span className="badge bg-slate-100 text-slate-600">{e.category}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-rose-600 line-through">{e.wrong}</td>
                  <td className="py-1.5 pr-2 text-emerald-700 font-medium">{e.correct}</td>
                  <td className="py-1.5 text-xs text-slate-500">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card title="你的作答">
          <div className="whitespace-pre-wrap text-sm text-slate-700 max-h-80 overflow-y-auto">{session.answer}</div>
        </Card>
        {result.improved_version && (
          <Card title="AI 修改版對照">
            <div className="whitespace-pre-wrap text-sm text-emerald-800 max-h-80 overflow-y-auto">
              {result.improved_version}
            </div>
          </Card>
        )}
      </div>

      {result.comment && (
        <Card title="總評">
          <div className="text-sm text-slate-700 leading-relaxed">{result.comment}</div>
        </Card>
      )}
    </div>
  );
}

/* ---------------- 歷史與趨勢 ---------------- */

function History() {
  const [rows, setRows] = useState<WritingSession[] | null>(null);
  const [viewing, setViewing] = useState<WritingSession | null>(null);

  const load = useCallback(async () => setRows(await api.get<WritingSession[]>('/api/writing/sessions')), []);
  useEffect(() => {
    load();
  }, [load]);

  if (!rows) return <Spinner />;

  const chartData = rows
    .filter((r) => r.score !== null || r.score100 !== null)
    .slice()
    .reverse()
    .map((r) => ({
      date: `${r.date.slice(5)}#${r.id}`,
      Email: r.kind === 'email' ? r.score : null,
      Discussion: r.kind === 'discussion' ? r.score : null,
      'Email百分制': r.kind === 'email' ? r.score100 : null,
      'Discussion百分制': r.kind === 'discussion' ? r.score100 : null,
    }));

  if (viewing) {
    let parsed: GradeResult = {};
    try {
      parsed = JSON.parse(viewing.feedback || '{}');
    } catch {
      parsed = { comment: viewing.feedback };
    }
    return (
      <div>
        <button className="btn-secondary mb-3" onClick={() => setViewing(null)}>
          ← 回歷史列表
        </button>
        <ResultView result={parsed} session={viewing} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="分數趨勢">
        {chartData.length === 0 ? (
          <EmptyState text="還沒有批改過的練習" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="band" domain={[0, 5]} tick={{ fontSize: 11 }} label={{ value: '/5', position: 'insideTopLeft', fontSize: 10 }} />
              <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: '/100', position: 'insideTopRight', fontSize: 10 }} />
              <Tooltip />
              <Line yAxisId="band" type="monotone" dataKey="Email" stroke="#4f46e5" connectNulls strokeWidth={2} />
              <Line yAxisId="band" type="monotone" dataKey="Discussion" stroke="#e11d48" connectNulls strokeWidth={2} />
              <Line yAxisId="pct" type="monotone" dataKey="Email百分制" stroke="#4f46e5" strokeDasharray="5 4" connectNulls strokeWidth={1.5} />
              <Line yAxisId="pct" type="monotone" dataKey="Discussion百分制" stroke="#e11d48" strokeDasharray="5 4" connectNulls strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
      <Card title={`練習紀錄(${rows.length})`}>
        {rows.length === 0 ? (
          <EmptyState text="還沒有練習紀錄,去練一篇吧!" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-2">日期</th>
                <th className="py-2 pr-2">題型</th>
                <th className="py-2 pr-2">分數</th>
                <th className="py-2 pr-2">字數</th>
                <th className="py-2 pr-2">用時</th>
                <th className="py-2 pr-2">Flex</th>
                <th className="py-2 pr-2">狀態</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-2">{r.date.slice(5)}</td>
                  <td className="py-2 pr-2">
                    <span
                      className={`badge ${r.kind === 'email' ? 'bg-brand-100 text-brand-700' : 'bg-rose-100 text-rose-700'}`}
                    >
                      {r.kind === 'email' ? 'Email' : 'Discussion'}
                    </span>
                  </td>
                  <td className="py-2 pr-2 font-bold">{r.score ?? '—'}</td>
                  <td className="py-2 pr-2">{r.word_count}</td>
                  <td className="py-2 pr-2">
                    {Math.floor(r.seconds_used / 60)}:{String(r.seconds_used % 60).padStart(2, '0')}
                    {r.overtime === 1 && <span className="text-rose-500">*</span>}
                  </td>
                  <td className="py-2 pr-2">{r.used_flex === 1 ? '✓' : ''}</td>
                  <td className="py-2 pr-2 text-xs text-slate-500">
                    {r.status === 'graded' ? '已批改' : r.status === 'submitted' ? '已送出' : '草稿'}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setViewing(r)}>
                      查看
                    </button>
                    <button
                      className="btn-ghost text-xs text-rose-500"
                      onClick={async () => {
                        if (confirm('刪除這筆紀錄?')) {
                          await api.del(`/api/writing/sessions/${r.id}`);
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
