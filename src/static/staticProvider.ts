/** 網頁版 PracticeProvider:題庫來自打包的種子 JSON + localStorage 的 AI 生成題 */
import bankReading from '../../seeds/bank_reading.json';
import bankListening from '../../seeds/bank_listening.json';
import bankWS from '../../seeds/bank_writing_speaking.json';
import type {
  BankItemData,
  BankListRow,
  PracticeProvider,
  PracticeResultInput,
  PracticeStats,
  ShadowScore,
} from '../practice/types';
import { shadowScoreLocal } from '../practice/diff';
import { aiCall } from './ai';
import { aiBankStore, results, wordsStore } from './store';

type AnyItem = Record<string, unknown> & { id: string };

const SEED_BANK: Record<string, AnyItem[]> = {
  ctw: bankReading.ctw as AnyItem[],
  daily_life: bankReading.daily_life as AnyItem[],
  academic: bankReading.academic as AnyItem[],
  lcr: bankListening.lcr as AnyItem[],
  conversation: bankListening.conversation as AnyItem[],
  announcement: bankListening.announcement as AnyItem[],
  talk: bankListening.talk as AnyItem[],
  build_sentence: bankWS.build_sentence as AnyItem[],
  lnr_set: bankWS.lnr_sets as AnyItem[],
};

function titleOf(qtype: string, d: AnyItem): string {
  const s = (k: string) => String(d[k] ?? '');
  switch (qtype) {
    case 'ctw':
    case 'academic':
    case 'daily_life':
    case 'lnr_set':
      return s('title');
    case 'lcr':
      return s('stimulus').slice(0, 60);
    case 'conversation':
    case 'announcement':
      return s('setting');
    case 'talk':
      return s('topic');
    case 'build_sentence':
      return s('context').slice(0, 60);
    default:
      return '';
  }
}

function allItems(qtype: string): { item_id: string; title: string; source: string; data: AnyItem }[] {
  const seeds = (SEED_BANK[qtype] ?? []).map((d) => ({
    item_id: d.id,
    title: titleOf(qtype, d),
    source: 'seed',
    data: d,
  }));
  const ai = (aiBankStore.all()[qtype] ?? []).map((x) => ({
    item_id: x.item_id,
    title: x.title,
    source: 'ai',
    data: x.data as AnyItem,
  }));
  return [...seeds, ...ai];
}

const GEN_KIND: Record<string, string> = {
  ctw: 'gen_ctw',
  daily_life: 'gen_daily_life',
  academic: 'gen_academic',
  lcr: 'gen_lcr',
  conversation: 'gen_conversation',
  announcement: 'gen_announcement',
  talk: 'gen_talk',
  build_sentence: 'gen_build_sentence',
};

export const staticProvider: PracticeProvider = {
  mode: 'static',

  async listItems(qtype): Promise<BankListRow[]> {
    const rows = results.all().filter((r) => r.qtype === qtype);
    const stat = new Map<string, { attempts: number; best: number }>();
    for (const r of rows) {
      const s = stat.get(r.item_id) ?? { attempts: 0, best: 0 };
      s.attempts++;
      s.best = Math.max(s.best, r.accuracy);
      stat.set(r.item_id, s);
    }
    return allItems(qtype).map((x) => ({
      qtype,
      item_id: x.item_id,
      title: x.title,
      source: x.source,
      attempts: stat.get(x.item_id)?.attempts ?? 0,
      best: stat.get(x.item_id)?.best ?? null,
    }));
  },

  async getItem(itemId) {
    for (const qtype of Object.keys(SEED_BANK)) {
      const hit = allItems(qtype).find((x) => x.item_id === itemId);
      if (hit) return { qtype, data: hit.data as unknown as BankItemData };
    }
    throw new Error('找不到題目');
  },

  async generate(qtype) {
    const kind = GEN_KIND[qtype];
    if (!kind) throw new Error(`此題型不支援 AI 出題`);
    const recent = allItems(qtype).slice(-15).map((x) => x.title).join('、') || '(無)';
    const r = await aiCall(kind as never, { exclude: recent });
    const item = r.parsed as AnyItem | null;
    if (!item) throw new Error('AI 回傳格式不符,請重試');
    item.id = `${qtype}-ai-${Date.now().toString(36)}`;
    aiBankStore.add(qtype, item.id, titleOf(qtype, item), item);
    return { item_id: item.id };
  },

  async submitResult(r: PracticeResultInput) {
    const accuracy = Math.round((r.correct / r.total) * 1000) / 10;
    results.add({
      qtype: r.qtype,
      item_id: r.item_id,
      correct: r.correct,
      total: r.total,
      accuracy,
      seconds: r.seconds,
      detail: r.detail,
    });
    const det = r.detail as { wrongWords?: string[] } | undefined;
    const added: string[] = [];
    if (r.qtype === 'ctw' && Array.isArray(det?.wrongWords)) {
      for (const w of det.wrongWords.slice(0, 10)) {
        wordsStore.addWord(w);
        added.push(w);
      }
    }
    return { accuracy, wordsAddedToSpelling: added };
  },

  async stats(): Promise<PracticeStats> {
    const rows = results.all();
    const byType = new Map<string, { attempts: number; sum: number; questions: number }>();
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      const t = byType.get(r.qtype) ?? { attempts: 0, sum: 0, questions: 0 };
      t.attempts++;
      t.sum += r.accuracy;
      t.questions += r.total;
      byType.set(r.qtype, t);
      const k = `${r.date}|${r.qtype}`;
      const d = byDay.get(k) ?? { sum: 0, n: 0 };
      d.sum += r.accuracy;
      d.n++;
      byDay.set(k, d);
    }
    return {
      totals: [...byType.entries()].map(([qtype, t]) => ({
        qtype,
        attempts: t.attempts,
        avg: t.sum / t.attempts,
        questions: t.questions,
      })),
      daily: [...byDay.entries()]
        .map(([k, d]) => {
          const [date, qtype] = k.split('|');
          return { date, qtype, acc: d.sum / d.n, n: d.n };
        })
        .sort((a, b) => a.date.localeCompare(b.date)),
      bankCounts: Object.keys(SEED_BANK).map((qtype) => ({ qtype, n: allItems(qtype).length })),
    };
  },

  /** 網頁版跟讀評分:用錄音期間的即時轉錄 + 本地 diff(不需伺服器) */
  async scoreShadow(_blob, target, webSpeechText): Promise<ShadowScore> {
    if (!webSpeechText.trim()) {
      throw new Error('沒有取得即時轉錄。請用 Chrome、允許麥克風,並在安靜環境再試一次。');
    }
    return shadowScoreLocal(target, webSpeechText);
  },
};
