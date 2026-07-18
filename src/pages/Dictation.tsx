import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import type { DictationMaterial } from '../types';

interface DiffOp {
  type: 'equal' | 'sub' | 'del' | 'ins';
  ref?: string;
  hyp?: string;
  close?: boolean;
}

const MISS_REASONS = ['連音', '弱讀', '生字', '語速'] as const;

export default function Dictation() {
  const [materials, setMaterials] = useState<DictationMaterial[] | null>(null);
  const [active, setActive] = useState<DictationMaterial | null>(null);
  const [stats, setStats] = useState<{
    daily: { date: string; acc: number; n: number }[];
    reasonTotals: Record<string, number>;
  } | null>(null);
  const [form, setForm] = useState({ title: '', transcript: '', source_note: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setMaterials(await api.get<DictationMaterial[]>('/api/dictation/materials'));
    setStats(await api.get('/api/dictation/stats'));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(kind: 'audio' | 'tts') {
    if (!form.transcript.trim()) {
      showToast('逐字稿必填', 'err');
      return;
    }
    const fd = new FormData();
    fd.append('title', form.title);
    fd.append('transcript', form.transcript);
    fd.append('source_note', form.source_note);
    fd.append('kind', kind);
    const f = fileRef.current?.files?.[0];
    if (kind === 'audio') {
      if (!f) {
        showToast('請選擇音檔,或改用「TTS 朗讀」模式', 'err');
        return;
      }
      fd.append('audio', f);
    }
    try {
      await api.upload('/api/dictation/materials', fd);
      setForm({ title: '', transcript: '', source_note: '' });
      if (fileRef.current) fileRef.current.value = '';
      showToast('素材已建立');
      load();
    } catch (e) {
      showToast((e as Error).message, 'err');
    }
  }

  if (active) {
    return (
      <DictationSession
        material={active}
        onExit={() => {
          setActive(null);
          load();
        }}
      />
    );
  }

  return (
    <div>
      {toast}
      <PageTitle title="聽寫工房" sub="1–2 句 A-B 循環·0.75x 變速·diff 對答案·錯字自動流入拼寫詞庫" />

      <div className="space-y-4">
        <Card title="建素材(建議來源:Magoosh 做過的題、TKB 講義)">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              className="input"
              placeholder="素材名稱"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <input
              className="input"
              placeholder="來源備註(選填)"
              value={form.source_note}
              onChange={(e) => setForm({ ...form, source_note: e.target.value })}
            />
          </div>
          <textarea
            className="input w-full mb-2"
            rows={3}
            placeholder="貼逐字稿(必填)。TTS 模式:一行一句,瀏覽器會逐句朗讀"
            value={form.transcript}
            onChange={(e) => setForm({ ...form, transcript: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.webm,.wav" className="text-sm" />
            <div className="ml-auto flex gap-2">
              <button className="btn-primary" onClick={() => create('audio')}>
                建立(音檔)
              </button>
              <button className="btn-secondary" onClick={() => create('tts')} title="不用音檔,瀏覽器朗讀句子">
                建立(TTS 朗讀)
              </button>
            </div>
          </div>
        </Card>

        {stats && stats.daily.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <Card title="每日聽寫正確率">
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={stats.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="acc" name="正確率%" stroke="#4f46e5" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title="漏聽原因累計">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={MISS_REASONS.map((r) => ({ reason: r, 次數: stats.reasonTotals[r] ?? 0 }))}
                  margin={{ left: -25 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="reason" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="次數" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        <Card title={`素材庫(${materials?.length ?? 0})`}>
          {!materials ? (
            <Spinner />
          ) : materials.length === 0 ? (
            <EmptyState text="還沒有素材" />
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
                      {m.source_note && `${m.source_note}·`}
                      {m.transcript.slice(0, 60)}...
                    </div>
                  </div>
                  <button className="btn-primary" onClick={() => setActive(m)}>
                    開始聽寫
                  </button>
                  <button
                    className="btn-ghost text-xs text-rose-500"
                    onClick={async () => {
                      if (confirm('刪除素材與其紀錄?')) {
                        await api.del(`/api/dictation/materials/${m.id}`);
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
    </div>
  );
}

/* ================= 聽寫進行中 ================= */

function DictationSession({ material, onExit }: { material: DictationMaterial; onExit: () => void }) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<{ ops: DiffOp[]; accuracy: number; misspelled: { wrong: string; correct: string }[] } | null>(null);
  const [reasons, setReasons] = useState<Record<string, number>>({ 連音: 0, 弱讀: 0, 生字: 0, 語速: 0 });
  const [saved, setSaved] = useState(false);
  const [toast, showToast] = useToast();

  async function check() {
    if (!text.trim()) {
      showToast('先寫再對答案', 'err');
      return;
    }
    const r = await api.post<{ ops: DiffOp[]; accuracy: number; misspelled: { wrong: string; correct: string }[] }>(
      '/api/dictation/check',
      { material_id: material.id, user_text: text }
    );
    setChecked(r);
  }

  async function saveAttempt() {
    const r = await api.post<{ accuracy: number; wordsAddedToSpelling: string[] }>('/api/dictation/attempts', {
      material_id: material.id,
      user_text: text,
      reasons,
    });
    setSaved(true);
    showToast(
      `已記錄(正確率 ${r.accuracy}%)${r.wordsAddedToSpelling.length > 0 ? `·錯字已加入拼寫詞庫:${r.wordsAddedToSpelling.join(', ')}` : ''}`
    );
  }

  return (
    <div className="space-y-3">
      {toast}
      <div className="flex items-center gap-2">
        <button className="btn-secondary" onClick={onExit}>
          ← 結束
        </button>
        <div className="font-semibold text-slate-800">{material.title}</div>
      </div>

      {material.kind === 'tts' ? (
        <TtsPlayer sentences={material.transcript.split('\n').filter((s) => s.trim())} voiceSeed={material.id} />
      ) : (
        <AbPlayer src={material.audio_path} />
      )}

      <Card title="逐字打出你聽到的(空白鍵在播放器聚焦時=播放/暫停)">
        <textarea
          className="input w-full font-mono text-sm leading-relaxed"
          rows={6}
          placeholder="聽 1–2 句 → 暫停 → 逐字打出來..."
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
            setSaved(false);
          }}
        />
        <div className="mt-2 flex gap-2">
          <button className="btn-primary" onClick={check}>
            對答案
          </button>
          {checked && !saved && (
            <button className="btn-secondary" onClick={saveAttempt}>
              記錄這次結果(錯字自動入拼寫詞庫)
            </button>
          )}
        </div>
      </Card>

      {checked && (
        <Card
          title={
            <span>
              對答案結果:<span className="text-brand-600 font-black">{checked.accuracy}%</span>
              <span className="ml-2 text-xs font-normal text-slate-400">
                紅=漏聽·黃=寫錯(刪除線是你寫的)·灰=多寫
              </span>
            </span>
          }
        >
          <div className="rounded-lg bg-slate-50 p-3 text-sm leading-loose">
            {checked.ops.map((op, i) => {
              if (op.type === 'equal') return <span key={i}>{op.ref} </span>;
              if (op.type === 'del')
                return (
                  <span key={i} className="rounded bg-rose-100 px-1 text-rose-700 font-medium">
                    {op.ref}{' '}
                  </span>
                );
              if (op.type === 'sub')
                return (
                  <span key={i} className="rounded bg-amber-100 px-1 text-amber-800">
                    <s className="text-rose-500">{op.hyp}</s>→{op.ref}{' '}
                  </span>
                );
              return (
                <span key={i} className="rounded bg-slate-200 px-1 text-slate-400 line-through">
                  {op.hyp}{' '}
                </span>
              );
            })}
          </div>
          <div className="mt-3">
            <div className="text-xs text-slate-500 mb-1.5">漏聽原因(點擊累計,存檔時一併記錄):</div>
            <div className="flex gap-2">
              {MISS_REASONS.map((r) => (
                <button
                  key={r}
                  className="btn-secondary"
                  onClick={() => setReasons({ ...reasons, [r]: (reasons[r] ?? 0) + 1 })}
                >
                  {r} ×{reasons[r] ?? 0}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---- A-B 循環播放器 ---- */

function AbPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [pos, setPos] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setPos(audio.currentTime);
      // A-B 循環
      if (a !== null && b !== null && audio.currentTime >= b) {
        audio.currentTime = a;
        audio.play();
      }
    };
    audio.addEventListener('timeupdate', onTime);
    return () => audio.removeEventListener('timeupdate', onTime);
  }, [a, b]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  // 快捷鍵:焦點在播放器區塊時,空白=播放/暫停,[ ]=設 A/B,\\=清除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return; // 打字時不攔截
      const audio = audioRef.current;
      if (!audio) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (audio.paused) audio.play();
        else audio.pause();
      }
      if (e.key === '[') setA(audio.currentTime);
      if (e.key === ']') setB(audio.currentTime);
      if (e.key === '\\') {
        setA(null);
        setB(null);
      }
      if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 3);
      if (e.key === 'ArrowRight') audio.currentTime += 3;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={wrapRef} className="card">
      <audio ref={audioRef} controls src={src} className="w-full h-10" />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <button className="btn-secondary" onClick={() => setA(audioRef.current?.currentTime ?? 0)}>
          設 A 點{a !== null && `(${a.toFixed(1)}s)`}
        </button>
        <button className="btn-secondary" onClick={() => setB(audioRef.current?.currentTime ?? 0)}>
          設 B 點{b !== null && `(${b.toFixed(1)}s)`}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setA(null);
            setB(null);
          }}
          disabled={a === null && b === null}
        >
          清除循環
        </button>
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1 ml-2">
          {[0.75, 1].map((r) => (
            <button
              key={r}
              className={`rounded-md px-2.5 py-0.5 text-xs ${rate === r ? 'bg-white shadow font-medium' : 'text-slate-600'}`}
              onClick={() => setRate(r)}
            >
              {r}x
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-400">
          {a !== null && b !== null && b > a ? `🔁 循環中 ${a.toFixed(1)}–${b.toFixed(1)}s·` : ''}
          {pos.toFixed(1)}s·快捷:空白=播/停 [ ]=A/B 點 \=清除 ←→=±3s
        </span>
      </div>
    </div>
  );
}

/* ---- TTS 逐句播放器 ---- */

function TtsPlayer({ sentences, voiceSeed = 0 }: { sentences: string[]; voiceSeed?: number }) {
  const [idx, setIdx] = useState(0);
  const [rate, setRate] = useState(0.9);
  const [speaking, setSpeaking] = useState(false);

  function speak(text: string) {
    setSpeaking(true);
    speakEn(text, rate, () => setSpeaking(false), pickVoice('any', hashSeed(String(voiceSeed))));
  }

  useEffect(() => () => speechSynthesis.cancel(), []);

  return (
    <div className="card">
      <div className="flex items-center gap-2">
        <span className="badge bg-violet-100 text-violet-700">TTS 句庫</span>
        <span className="text-sm text-slate-600">
          第 {idx + 1}/{sentences.length} 句(內容先不看,聽寫完再對答案)
        </span>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-200 p-1">
          {[0.7, 0.9, 1.1].map((r) => (
            <button
              key={r}
              className={`rounded-md px-2.5 py-0.5 text-xs ${rate === r ? 'bg-white shadow font-medium' : 'text-slate-600'}`}
              onClick={() => setRate(r)}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="btn-secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
          ← 上一句
        </button>
        <button className="btn-primary flex-1" onClick={() => speak(sentences[idx])}>
          {speaking ? '🔊 播放中...(可重按重播)' : `🔊 播放第 ${idx + 1} 句`}
        </button>
        <button className="btn-secondary" disabled={idx === sentences.length - 1} onClick={() => setIdx(idx + 1)}>
          下一句 →
        </button>
      </div>
      <div className="mt-2 text-xs text-slate-400">
        建議流程:播一句 → 逐字打 → 下一句;全部打完按「對答案」。聽不清就重播,別偷看答案!
      </div>
    </div>
  );
}
