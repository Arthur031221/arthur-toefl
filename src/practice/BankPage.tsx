/** 題庫通用頁:列表 → 練習 → 交卷記錄 → 下一題;含每題型 AI 出題 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, EmptyState, PageTitle, Spinner, useToast } from '../components/ui';
import { usePractice } from './context';
import { BuildSentenceCard, CtwCard, McqCard, type CardResult } from './cards';
import { LnrExam } from './LnrExam';
import type {
  AcademicItem,
  AnnouncementItem,
  BankItemData,
  BankListRow,
  BuildSentenceItem,
  ConversationItem,
  CtwItem,
  DailyLifeItem,
  LcrItem,
  LnrSetItem,
  PracticeStats,
  TalkItem,
} from './types';
import { QTYPE_LABEL } from './types';

export function BankTypePanel({ qtype }: { qtype: string }) {
  const provider = usePractice();
  const [rows, setRows] = useState<BankListRow[] | null>(null);
  const [active, setActive] = useState<{ itemId: string; data: BankItemData } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [finished, setFinished] = useState<{ accuracy: number; words?: string[] } | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setRows(await provider.listItems(qtype));
  }, [provider, qtype]);

  useEffect(() => {
    setActive(null);
    setFinished(null);
    load();
  }, [load]);

  async function open(itemId: string) {
    const r = await provider.getItem(itemId);
    setFinished(null);
    setActive({ itemId, data: r.data });
  }

  function pickNext() {
    if (!rows || rows.length === 0) return;
    const pool = [...rows].sort((a, b) => a.attempts - b.attempts || Math.random() - 0.5);
    const candidates = pool.filter((r) => r.item_id !== active?.itemId);
    const next = (candidates.length > 0 ? candidates : pool)[0];
    void open(next.item_id);
  }

  async function generate() {
    setGenerating(true);
    try {
      const r = await provider.generate(qtype);
      showToast('AI 出題完成,直接開練!');
      await load();
      await open(r.item_id);
    } catch (e) {
      showToast((e as Error).message, 'err');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDone(r: CardResult) {
    try {
      const saved = await provider.submitResult({
        qtype,
        item_id: active!.itemId,
        correct: r.correct,
        total: r.total,
        seconds: r.seconds,
        detail: r.detail,
      });
      setFinished({ accuracy: saved.accuracy, words: saved.wordsAddedToSpelling });
      load();
    } catch (e) {
      showToast(`結果儲存失敗:${(e as Error).message}`, 'err');
    }
  }

  if (!rows) return <Spinner />;

  // 練習中
  if (active) {
    const d = active.data;
    return (
      <div className="space-y-3">
        {toast}
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => setActive(null)}>
            ← 回題庫列表
          </button>
          {finished && (
            <>
              <span className={`badge ${finished.accuracy >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                本題成績 {finished.accuracy}/100(已記錄)
              </span>
              {finished.words && finished.words.length > 0 && (
                <span className="text-xs text-slate-500">錯字已入拼寫詞庫:{finished.words.join(', ')}</span>
              )}
            </>
          )}
          <button className="btn-primary ml-auto" onClick={pickNext}>
            下一題 →
          </button>
        </div>
        {qtype === 'ctw' && <CtwCard key={active.itemId} item={d as CtwItem} onDone={handleDone} />}
        {qtype === 'daily_life' && (
          <McqCard key={active.itemId} material={{ mode: 'read', kind: 'daily_life', item: d as DailyLifeItem }} onDone={handleDone} />
        )}
        {qtype === 'academic' && (
          <McqCard key={active.itemId} material={{ mode: 'read', kind: 'academic', item: d as AcademicItem }} onDone={handleDone} />
        )}
        {qtype === 'lcr' && (
          <McqCard key={active.itemId} material={{ mode: 'listen', kind: 'lcr', item: d as LcrItem }} onDone={handleDone} />
        )}
        {qtype === 'conversation' && (
          <McqCard key={active.itemId} material={{ mode: 'listen', kind: 'conversation', item: d as ConversationItem }} onDone={handleDone} />
        )}
        {qtype === 'announcement' && (
          <McqCard key={active.itemId} material={{ mode: 'listen', kind: 'announcement', item: d as AnnouncementItem }} onDone={handleDone} />
        )}
        {qtype === 'talk' && (
          <McqCard key={active.itemId} material={{ mode: 'listen', kind: 'talk', item: d as TalkItem }} onDone={handleDone} />
        )}
        {qtype === 'build_sentence' && (
          <BuildSentenceCard key={active.itemId} item={d as BuildSentenceItem} onDone={handleDone} />
        )}
        {qtype === 'lnr_set' && (
          <LnrExam key={active.itemId} item={d as LnrSetItem} onDone={handleDone} onExit={() => setActive(null)} />
        )}
      </div>
    );
  }

  // 列表
  return (
    <div className="space-y-3">
      {toast}
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={pickNext} disabled={rows.length === 0}>
          ▶ 開始練(優先沒練過的)
        </button>
        <button className="btn-secondary" onClick={generate} disabled={generating}>
          {generating ? 'AI 出題中(最長 90 秒)...' : '🤖 AI 出一題新的'}
        </button>
        <span className="ml-auto text-xs text-slate-400">
          共 {rows.length} 題·已練 {rows.filter((r) => r.attempts > 0).length} 題
        </span>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState text="題庫是空的,按「AI 出一題」開始累積" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.item_id}>
                <button className="flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-slate-50 rounded" onClick={() => open(r.item_id)}>
                  {r.source === 'ai' && <span className="badge bg-violet-100 text-violet-600 shrink-0">AI</span>}
                  <span className="flex-1 truncate text-sm text-slate-700">{r.title || r.item_id}</span>
                  {r.attempts > 0 ? (
                    <span className={`badge ${Number(r.best) >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      最佳 {Math.round(Number(r.best))}·練過 {r.attempts} 次
                    </span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-400">未練</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function BankPage({
  title,
  sub,
  tabs,
}: {
  title: string;
  sub: string;
  tabs: { qtype: string; label?: string }[];
}) {
  const provider = usePractice();
  const [tab, setTab] = useState(tabs[0].qtype);
  const [stats, setStats] = useState<PracticeStats | null>(null);

  useEffect(() => {
    provider.stats().then(setStats).catch(() => setStats(null));
  }, [provider, tab]);

  const statOf = useMemo(() => {
    const m = new Map(stats?.totals.map((t) => [t.qtype, t]) ?? []);
    return (q: string) => m.get(q);
  }, [stats]);

  return (
    <div>
      <PageTitle title={title} sub={sub} />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const s = statOf(t.qtype);
          return (
            <button key={t.qtype} className={tab === t.qtype ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(t.qtype)}>
              {t.label ?? QTYPE_LABEL[t.qtype]}
              {s && <span className="ml-1.5 text-xs opacity-75">{Math.round(s.avg)}%</span>}
            </button>
          );
        })}
      </div>
      <BankTypePanel qtype={tab} />
    </div>
  );
}
