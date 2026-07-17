/** Listen and Repeat 正式考模式:7 句連發、播完約 2 秒就得複誦、句子越來越長 */
import { useEffect, useRef, useState } from 'react';
import { useRecorder, useWebSpeech, webSpeechSupported } from '../hooks/useRecorder';
import type { LnrSetItem, ShadowScore } from './types';
import { usePractice } from './context';
import type { CardResult } from './cards';

const REC_SECONDS = [8, 8, 9, 10, 10, 11, 12];

type Phase = 'ready' | 'playing' | 'gap' | 'recording' | 'between' | 'scoring' | 'done';

export function LnrExam({ item, onDone, onExit }: { item: LnrSetItem; onDone: (r: CardResult) => void; onExit: () => void }) {
  const provider = usePractice();
  const [phase, setPhase] = useState<Phase>('ready');
  const [idx, setIdx] = useState(0);
  const [gapLeft, setGapLeft] = useState(2);
  const [scoringIdx, setScoringIdx] = useState(0);
  const [results, setResults] = useState<(ShadowScore | { error: string })[]>([]);
  const recorder = useRecorder();
  const speech = useWebSpeech();
  const blobsRef = useRef<{ blob: Blob; ws: string }[]>([]);
  const idxRef = useRef(0);
  idxRef.current = idx;

  const sentences = item.sentences.slice(0, 7);
  const useWs = webSpeechSupported();

  useEffect(() => () => speechSynthesis.cancel(), []);

  function playSentence(i: number) {
    setPhase('playing');
    const text = sentences[i];
    let fired = false;
    const proceed = () => {
      if (fired) return;
      fired = true;
      startGap(i);
    };
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.95;
      u.onend = proceed;
      setTimeout(() => speechSynthesis.speak(u), 180);
      // onend 不可靠時的保險絲:估算時長
      const est = 1200 + text.split(/\s+/).length * 480;
      setTimeout(proceed, est + 1500);
    } catch {
      proceed();
    }
  }

  function startGap(i: number) {
    setPhase('gap');
    setGapLeft(2);
    let left = 2;
    const t = setInterval(() => {
      left -= 1;
      setGapLeft(left);
      if (left <= 0) {
        clearInterval(t);
        record(i);
      }
    }, 1000);
  }

  function record(i: number) {
    setPhase('recording');
    if (useWs) speech.start();
    recorder.start({
      countdownSec: 0,
      maxSeconds: REC_SECONDS[i] ?? 10,
      onStop: (blob) => {
        const ws = useWs ? speech.stop() : '';
        blobsRef.current.push({ blob, ws });
        if (i + 1 < sentences.length) {
          setPhase('between');
          setIdx(i + 1);
          setTimeout(() => playSentence(i + 1), 900);
        } else {
          void scoreAll();
        }
      },
    });
  }

  async function scoreAll() {
    setPhase('scoring');
    const out: (ShadowScore | { error: string })[] = [];
    for (let i = 0; i < blobsRef.current.length; i++) {
      setScoringIdx(i);
      const { blob, ws } = blobsRef.current[i];
      try {
        out.push(await provider.scoreShadow(blob, sentences[i], ws));
      } catch (e) {
        out.push({ error: (e as Error).message });
      }
    }
    setResults(out);
    setPhase('done');
    const scored = out.filter((r): r is ShadowScore => !('error' in r));
    const passed = scored.filter((r) => r.accuracy >= 80).length;
    const avg = scored.length > 0 ? Math.round(scored.reduce((s, r) => s + r.accuracy, 0) / scored.length) : 0;
    onDone({
      correct: passed,
      total: sentences.length,
      seconds: 0,
      detail: { avgClarity: avg, perSentence: scored.map((r) => r.accuracy) },
    });
  }

  const allUnclear = [
    ...new Set(
      results.flatMap((r) => ('error' in r ? [] : r.unclear.map((u) => u.word)))
    ),
  ];

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-semibold text-slate-800">
          🎧 L&R 正式考模式|{item.title}
          <span className="ml-2 text-xs font-normal text-slate-400">7 句連發·播完 2 秒就開始複誦·8–12 秒作答</span>
        </div>
        <button className="btn-secondary" onClick={() => { speechSynthesis.cancel(); recorder.stop(); onExit(); }}>
          離開
        </button>
      </div>

      {recorder.error && <div className="mb-2 rounded-lg bg-rose-50 border border-rose-200 p-2 text-sm text-rose-700">{recorder.error}</div>}

      {phase === 'ready' && (
        <div className="py-6 text-center">
          <div className="mb-3 text-sm text-slate-500">
            準備好就開始。每句只播一次,聽完 2 秒後自動開錄,講完等自動跳下一句(全程免手動)。
            {!useWs && provider.mode === 'static' && <div className="mt-1 text-rose-500">此瀏覽器不支援即時轉錄,建議用 Chrome</div>}
          </div>
          <button className="btn-primary text-base px-6 py-2.5" onClick={() => playSentence(0)}>
            ▶ 開始(共 7 句)
          </button>
        </div>
      )}

      {(phase === 'playing' || phase === 'gap' || phase === 'recording' || phase === 'between') && (
        <div className="py-6 text-center">
          <div className="mb-2 text-xs text-slate-400">第 {idx + 1}/7 句</div>
          {phase === 'playing' && <div className="text-2xl font-bold text-slate-700">🔊 聆聽中...</div>}
          {phase === 'gap' && <div className="text-4xl font-black text-amber-500">{gapLeft}</div>}
          {phase === 'recording' && (
            <div>
              <div className="mb-2 flex items-center justify-center gap-2 text-rose-600 font-bold">
                <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-rose-600" />
                複誦中 {recorder.elapsed.toFixed(1)}s/{REC_SECONDS[idx]}s
              </div>
              <div className="mx-auto h-2.5 w-1/2 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-rose-500 transition-all" style={{ width: `${(recorder.elapsed / (REC_SECONDS[idx] || 10)) * 100}%` }} />
              </div>
              <button className="btn-secondary mt-3" onClick={recorder.stop}>
                講完了,提前跳下一句
              </button>
            </div>
          )}
          {phase === 'between' && <div className="text-lg text-slate-500">下一句...</div>}
        </div>
      )}

      {phase === 'scoring' && (
        <div className="py-8 text-center text-sm text-slate-500">
          比對中 {scoringIdx + 1}/7(轉錄+標記講不清楚的字)...
        </div>
      )}

      {phase === 'done' && (
        <div>
          <div className="mb-3 flex items-center gap-5">
            <div>
              <div className="text-4xl font-black text-brand-600">
                {results.filter((r) => !('error' in r) && r.accuracy >= 80).length}
                <span className="text-base text-slate-400">/7 句達標</span>
              </div>
              <div className="text-xs text-slate-500">達標=清晰度 ≥80</div>
            </div>
            {allUnclear.length > 0 && (
              <div className="flex-1">
                <div className="text-xs font-semibold text-slate-500 mb-1">講不清楚的字:</div>
                <div className="flex flex-wrap gap-1">
                  {allUnclear.slice(0, 24).map((w) => (
                    <span key={w} className="badge bg-rose-100 text-rose-700">{w}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {sentences.map((s, i) => {
                const r = results[i];
                return (
                  <tr key={i}>
                    <td className="py-1.5 pr-2 text-xs text-slate-400 align-top">{i + 1}</td>
                    <td className="py-1.5 pr-2">
                      <div>{s}</div>
                      {r && !('error' in r) && r.transcript && (
                        <div className="text-xs text-slate-400">你:{r.transcript}</div>
                      )}
                      {r && 'error' in r && <div className="text-xs text-rose-500">{r.error}</div>}
                    </td>
                    <td className="py-1.5 text-right align-top">
                      {r && !('error' in r) && (
                        <span className={`badge ${r.accuracy >= 80 ? 'bg-emerald-100 text-emerald-700' : r.accuracy >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                          {r.accuracy}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                blobsRef.current = [];
                setResults([]);
                setIdx(0);
                setPhase('ready');
              }}
            >
              🔁 再考一輪
            </button>
            <button className="btn-secondary" onClick={onExit}>
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
