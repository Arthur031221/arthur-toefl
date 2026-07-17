/** 共用練習元件:CTW 打字 / MCQ(閱讀+聽力) / 句子重組。純 props 驅動,雙模式共用 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { speakEn } from '../audio-utils';
import type {
  AcademicItem,
  AnnouncementItem,
  BuildSentenceItem,
  ConversationItem,
  CtwItem,
  DailyLifeItem,
  LcrItem,
  McqQ,
  TalkItem,
} from './types';
import { parseCtw } from './types';

export interface CardResult {
  correct: number;
  total: number;
  seconds: number;
  detail?: unknown;
}

/* ---------------- 計時器 ---------------- */

export function useElapsed(running: boolean) {
  const [sec, setSec] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now();
    setSec(0);
    const t = setInterval(() => setSec((Date.now() - startRef.current) / 1000), 500);
    return () => clearInterval(t);
  }, [running]);
  return sec;
}

function Timer({ sec, limit }: { sec: number; limit?: number }) {
  const over = limit !== undefined && sec > limit;
  return (
    <span className={`badge tabular-nums ${over ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
      ⏱ {Math.floor(sec / 60)}:{String(Math.floor(sec % 60)).padStart(2, '0')}
      {limit !== undefined && <span className="ml-1 opacity-70">/建議 {Math.floor(limit / 60)}:{String(limit % 60).padStart(2, '0')}</span>}
    </span>
  );
}

/* ---------------- CTW 完形填空 ---------------- */

export function CtwCard({ item, onDone }: { item: CtwItem; onDone: (r: CardResult) => void }) {
  const parts = useMemo(() => parseCtw(item.text), [item.text]);
  const blanks = parts.filter((p) => p.t === 'blank') as { t: 'blank'; show: string; ans: string }[];
  const [values, setValues] = useState<string[]>(blanks.map(() => ''));
  const [checked, setChecked] = useState(false);
  const sec = useElapsed(!checked);
  const secRef = useRef(0);
  secRef.current = sec;

  function submit() {
    if (checked) return;
    setChecked(true);
    const results = blanks.map((b, i) => values[i].trim().toLowerCase() === b.ans.toLowerCase());
    const correct = results.filter(Boolean).length;
    const wrongWords = blanks.filter((_, i) => !results[i]).map((b) => b.show + b.ans);
    onDone({ correct, total: blanks.length, seconds: Math.round(secRef.current), detail: { wrongWords } });
  }

  let blankIdx = -1;
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold text-slate-800">{item.title}</div>
        <Timer sec={sec} limit={120} />
      </div>
      <div className="text-[15px] leading-loose text-slate-700">
        <span>{item.intro} </span>
        {parts.map((p, i) => {
          if (p.t === 'text') return <span key={i}>{p.s}</span>;
          blankIdx++;
          const bi = blankIdx;
          const ok = checked && values[bi].trim().toLowerCase() === p.ans.toLowerCase();
          return (
            <span key={i} className="whitespace-nowrap">
              <span className="font-medium">{p.show}</span>
              <input
                className={`mx-0.5 inline-block border-b-2 bg-transparent px-0.5 text-center font-mono outline-none ${
                  checked ? (ok ? 'border-emerald-500 text-emerald-700' : 'border-rose-500 text-rose-600') : 'border-brand-400'
                }`}
                style={{ width: `${Math.max(3, p.ans.length + 1)}ch` }}
                value={values[bi]}
                readOnly={checked}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^A-Za-z'’-]/g, '');
                  setValues((prev) => prev.map((x, j) => (j === bi ? v : x)));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
              {checked && !ok && <b className="text-emerald-600 text-xs">({p.ans})</b>}
            </span>
          );
        })}
      </div>
      {!checked ? (
        <button className="btn-primary mt-3" onClick={submit}>
          交卷(10 格)
        </button>
      ) : (
        <div className="mt-3 text-sm text-slate-600">
          ✔ 已交卷。打錯的完整單字會自動加入拼寫詞庫(完形填空同時在考你的拼寫!)
        </div>
      )}
    </div>
  );
}

/* ---------------- 通用 MCQ(閱讀直接看,聽力先聽後答) ---------------- */

type McqMaterial =
  | { mode: 'read'; kind: 'daily_life'; item: DailyLifeItem }
  | { mode: 'read'; kind: 'academic'; item: AcademicItem }
  | { mode: 'listen'; kind: 'lcr'; item: LcrItem }
  | { mode: 'listen'; kind: 'conversation'; item: ConversationItem }
  | { mode: 'listen'; kind: 'announcement'; item: AnnouncementItem }
  | { mode: 'listen'; kind: 'talk'; item: TalkItem };

export function McqCard({ material, onDone }: { material: McqMaterial; onDone: (r: CardResult) => void }) {
  const questions: McqQ[] =
    material.kind === 'lcr'
      ? [{ q: '選出最合適的回應', options: material.item.options, answer: material.item.answer, why: material.item.why }]
      : material.item.questions;
  const [picked, setPicked] = useState<number[]>(questions.map(() => -1));
  const [checked, setChecked] = useState(false);
  const [plays, setPlays] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const sec = useElapsed(!checked);
  const secRef = useRef(0);
  secRef.current = sec;

  const isListen = material.mode === 'listen';
  const timeLimit =
    material.kind === 'daily_life' ? questions.length * 45 : material.kind === 'academic' ? 300 : undefined;

  function playAudio() {
    setPlays((p) => p + 1);
    setSpeaking(true);
    if (material.kind === 'conversation') {
      const turns = material.item.turns;
      let i = 0;
      const next = () => {
        if (i >= turns.length) {
          setSpeaking(false);
          return;
        }
        const t = turns[i++];
        try {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(t.text);
          u.lang = 'en-US';
          u.rate = 0.95;
          u.pitch = t.spk === 'M' ? 0.75 : 1.2; // 兩個角色用音高區分
          u.onend = () => setTimeout(next, 350);
          setTimeout(() => speechSynthesis.speak(u), i === 1 ? 180 : 0);
        } catch {
          setSpeaking(false);
        }
      };
      next();
    } else {
      const text =
        material.kind === 'lcr' ? material.item.stimulus : material.kind === 'announcement' || material.kind === 'talk' ? material.item.text : '';
      speakEn(text, 0.95, () => setSpeaking(false));
    }
  }

  useEffect(() => () => speechSynthesis.cancel(), []);

  function submit() {
    if (checked || picked.some((p) => p < 0)) return;
    setChecked(true);
    speechSynthesis.cancel();
    const correct = questions.filter((q, i) => picked[i] === q.answer).length;
    onDone({ correct, total: questions.length, seconds: Math.round(secRef.current), detail: { picked, plays } });
  }

  const scriptText =
    material.kind === 'lcr'
      ? material.item.stimulus
      : material.kind === 'conversation'
        ? material.item.turns.map((t) => `${t.spk === 'M' ? '男' : '女'}:${t.text}`).join('\n')
        : material.kind === 'announcement' || material.kind === 'talk'
          ? material.item.text
          : '';

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold text-slate-800">
          {material.kind === 'daily_life' && `${material.item.title}(${material.item.kind})`}
          {material.kind === 'academic' && material.item.title}
          {material.kind === 'lcr' && '聽一句,選回應'}
          {material.kind === 'conversation' && `對話:${material.item.setting}`}
          {material.kind === 'announcement' && `公告:${material.item.setting}`}
          {material.kind === 'talk' && `短講:${material.item.topic}`}
        </div>
        <Timer sec={sec} limit={timeLimit} />
      </div>

      {/* 素材:閱讀直接顯示;聽力用 TTS,交卷後才顯示原文 */}
      {material.mode === 'read' ? (
        <div
          className={`mb-3 whitespace-pre-wrap rounded-lg border p-3 text-sm leading-relaxed text-slate-700 ${
            material.kind === 'daily_life' ? 'border-amber-200 bg-amber-50/60 font-medium' : 'border-slate-200 bg-slate-50'
          }`}
        >
          {material.kind === 'daily_life' ? material.item.body : material.kind === 'academic' ? material.item.passage : ''}
        </div>
      ) : (
        <div className="mb-3 rounded-lg bg-slate-800 p-3 text-center">
          <button className="btn bg-white text-slate-800 hover:bg-slate-100" onClick={playAudio} disabled={speaking}>
            {speaking ? '🔊 播放中...' : plays === 0 ? '🔊 播放音檔' : `🔊 再聽一次(已播 ${plays} 次)`}
          </button>
          <div className="mt-1.5 text-[11px] text-slate-400">正式考只能聽一次,練習時盡量一次作答;交卷後顯示原文</div>
          {checked && <div className="mt-2 whitespace-pre-wrap rounded bg-slate-700 p-2 text-left text-xs text-slate-200">{scriptText}</div>}
        </div>
      )}

      {/* 題目 */}
      <div className="space-y-3">
        {questions.map((q, qi) => (
          <div key={qi}>
            <div className="mb-1 text-sm font-medium text-slate-800">
              {questions.length > 1 && <span className="mr-1 text-slate-400">{qi + 1}.</span>}
              {q.q}
              {q.qtype && <span className="ml-1.5 badge bg-slate-100 text-slate-400">{q.qtype}</span>}
            </div>
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {q.options.map((opt, oi) => {
                const isPicked = picked[qi] === oi;
                const isAns = q.answer === oi;
                return (
                  <button
                    key={oi}
                    disabled={checked}
                    onClick={() => setPicked((prev) => prev.map((p, j) => (j === qi ? oi : p)))}
                    className={`rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors ${
                      checked
                        ? isAns
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                          : isPicked
                            ? 'border-rose-400 bg-rose-50 text-rose-700'
                            : 'border-slate-200 text-slate-400'
                        : isPicked
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <b className="mr-1">{String.fromCharCode(65 + oi)}.</b>
                    {opt}
                  </button>
                );
              })}
            </div>
            {checked && q.why && <div className="mt-1 text-xs text-slate-500">💡 {q.why}</div>}
          </div>
        ))}
      </div>

      {!checked && (
        <button className="btn-primary mt-3" onClick={submit} disabled={picked.some((p) => p < 0)}>
          交卷{picked.some((p) => p < 0) && '(還有題目沒選)'}
        </button>
      )}
    </div>
  );
}

/* ---------------- Build a Sentence 句子重組 ---------------- */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function BuildSentenceCard({ item, onDone }: { item: BuildSentenceItem; onDone: (r: CardResult) => void }) {
  const answerWords = useMemo(() => item.answer.split(/\s+/).filter(Boolean), [item.answer]);
  const [pool, setPool] = useState<{ w: string; k: number }[]>([]);
  const [built, setBuilt] = useState<{ w: string; k: number }[]>([]);
  const [checked, setChecked] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const doneRef = useRef(false);

  useEffect(() => {
    let words = shuffle(answerWords.map((w, k) => ({ w, k })));
    if (answerWords.length > 1) {
      let guard = 0;
      while (words.map((x) => x.w).join(' ') === item.answer && guard++ < 10) {
        words = shuffle(words);
      }
    }
    setPool(words);
    setBuilt([]);
    setChecked(false);
    setSecondsLeft(60);
    doneRef.current = false;
  }, [item.id, answerWords, item.answer]);

  useEffect(() => {
    if (checked) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          submitNow();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, item.id]);

  const builtRef = useRef(built);
  builtRef.current = built;

  function submitNow() {
    if (doneRef.current) return;
    doneRef.current = true;
    setChecked(true);
    const mine = builtRef.current.map((x) => x.w).join(' ');
    const ok = mine.toLowerCase() === item.answer.toLowerCase();
    onDone({ correct: ok ? 1 : 0, total: 1, seconds: 60 - secondsLeft, detail: { mine } });
  }

  const mine = built.map((x) => x.w).join(' ');
  const ok = checked && mine.toLowerCase() === item.answer.toLowerCase();

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-slate-500">把打亂的字排回正確語序(限時 60 秒)</div>
        <span className={`badge tabular-nums ${secondsLeft <= 10 && !checked ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
          ⏱ {secondsLeft}s
        </span>
      </div>
      <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
        <b>A:</b> {item.context}
      </div>

      <div
        className={`mb-2 min-h-[52px] rounded-lg border-2 border-dashed p-2.5 text-[15px] leading-relaxed ${
          checked ? (ok ? 'border-emerald-400 bg-emerald-50' : 'border-rose-400 bg-rose-50') : 'border-brand-300 bg-brand-50/40'
        }`}
      >
        <b className="mr-1 text-slate-500">B:</b>
        {built.length === 0 && !checked && <span className="text-sm text-slate-400">(點下方單字,依序排進來;點錯了再點一下移回去)</span>}
        {built.map((x) => (
          <button
            key={x.k}
            disabled={checked}
            className="mx-0.5 rounded bg-white px-1.5 py-0.5 shadow-sm border border-slate-200 hover:border-rose-300"
            onClick={() => {
              setBuilt((b) => b.filter((y) => y.k !== x.k));
              setPool((p) => [...p, x]);
            }}
          >
            {x.w}
          </button>
        ))}
        {checked && <span className="ml-1 text-slate-500">{item.punct ?? '.'}</span>}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {pool.map((x) => (
          <button
            key={x.k}
            disabled={checked}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[15px] hover:border-brand-400 hover:bg-brand-50"
            onClick={() => {
              setPool((p) => p.filter((y) => y.k !== x.k));
              setBuilt((b) => [...b, x]);
            }}
          >
            {x.w}
          </button>
        ))}
      </div>

      {!checked ? (
        <button className="btn-primary" onClick={submitNow} disabled={pool.length > 0}>
          交卷{pool.length > 0 && `(還有 ${pool.length} 個字)`}
        </button>
      ) : (
        <div className="text-sm">
          {ok ? (
            <span className="font-bold text-emerald-600">✓ 正確!</span>
          ) : (
            <div>
              <div className="text-rose-600">✗ 你的排序:{mine || '(空白)'}</div>
              <div className="font-medium text-emerald-700">正解:{item.answer}{item.punct ?? '.'}</div>
            </div>
          )}
          {item.hint_zh && <div className="mt-1 text-xs text-slate-500">💡 {item.hint_zh}</div>}
        </div>
      )}
    </div>
  );
}
