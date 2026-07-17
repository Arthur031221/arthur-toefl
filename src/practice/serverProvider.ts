/** localhost 模式:資料走 Express API(whisper/CLI 全功能) */
import { api } from '../api';
import { webSpeechSupported } from '../hooks/useRecorder';
import type {
  BankItemData,
  BankListRow,
  PracticeProvider,
  PracticeResultInput,
  PracticeStats,
  ShadowScore,
} from './types';

let whisperAvailable: boolean | null = null;
async function hasWhisper(): Promise<boolean> {
  if (whisperAvailable === null) {
    try {
      const s = await api.get<{ whisper: string }>('/api/system/status');
      whisperAvailable = s.whisper !== 'none';
    } catch {
      whisperAvailable = false;
    }
  }
  return whisperAvailable;
}

export const serverProvider: PracticeProvider = {
  mode: 'server',

  listItems: (qtype) => api.get<BankListRow[]>(`/api/bank?qtype=${encodeURIComponent(qtype)}`),

  getItem: async (itemId) => {
    const r = await api.get<{ qtype: string; data: BankItemData }>(`/api/bank/item/${encodeURIComponent(itemId)}`);
    return { qtype: r.qtype, data: r.data };
  },

  generate: async (qtype) => {
    const r = await api.post<{ item_id: string }>('/api/bank/generate', { qtype });
    return { item_id: r.item_id };
  },

  submitResult: (r: PracticeResultInput) =>
    api.post<{ accuracy: number; wordsAddedToSpelling?: string[] }>('/api/practice/results', r),

  stats: () => api.get<PracticeStats>('/api/practice/stats'),

  scoreShadow: async (blob, target, webSpeechText): Promise<ShadowScore> => {
    const form = new FormData();
    form.append('mode', 'repeat');
    form.append('question', target);
    form.append('audio', blob, 'shadow.webm');
    const up = await api.upload<{ session: { id: number } }>('/api/speaking/upload', form);
    const sid = up.session.id;
    if (await hasWhisper()) {
      await api.post(`/api/speaking/sessions/${sid}/transcribe`);
    } else if (webSpeechText) {
      await api.patch(`/api/speaking/sessions/${sid}`, {
        transcript: webSpeechText,
        transcript_source: 'webspeech',
      });
    } else if (webSpeechSupported()) {
      throw new Error('本機沒有 whisper,且這次錄音沒有即時轉錄結果,請重試');
    } else {
      throw new Error('沒有可用的轉錄方式(whisper 未裝、瀏覽器不支援即時轉錄)');
    }
    return api.post<ShadowScore>('/api/repeat/shadow-score', { session_id: sid });
  },
};
