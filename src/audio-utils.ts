/** 播放端防切頭工具 */

let ctx: AudioContext | null = null;

/**
 * 讓系統音訊輸出保持喚醒:Linux(PulseAudio/PipeWire)的 suspend-on-idle
 * 會在裝置閒置後休眠,任何新播放的前幾百毫秒會被吞掉。
 * 掛一條 20Hz、近乎無聲的振盪器讓裝置一直醒著。
 * 瀏覽器要求使用者互動後才能啟動 AudioContext,由 App 綁定第一次點擊呼叫。
 */
export function armAudioKeepAlive(): void {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 20; // 低於可聽範圍邊緣
    gain.gain.value = 0.0005; // 幾乎無聲,只為維持輸出裝置活著
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    void ctx.resume();
  } catch {
    ctx = null; // 不支援就算了,不影響功能
  }
}

/* ---------------- 語音庫:讓聽力有不同的聲音 ---------------- */

let enVoices: SpeechSynthesisVoice[] = [];

function refreshVoices(): void {
  try {
    enVoices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  } catch {
    enVoices = [];
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  try {
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  } catch {
    /* 舊瀏覽器 */
  }
}

// 常見語音名稱的性別判斷(先驗 female,因為 "female" 內含 "male")
const FEMALE_RE =
  /female|woman|samantha|victoria|karen|moira|tessa|zira|jenny|aria|michelle|susan|hazel|kate|serena|allison|ava|emma|joanna|salli|kendra|kimberly|ivy|amy|nicole|olivia|lucy|libby|sonia|natasha|catherine|fiona|veena/i;
const MALE_RE =
  /male|alex\b|daniel|fred|david|mark|george|james|ryan|guy\b|matthew|joey|justin|kevin|brian|russell|oliver|thomas|william|christopher|eric|liam|aaron/i;

export function voiceGender(v: SpeechSynthesisVoice): 'female' | 'male' | 'unknown' {
  if (FEMALE_RE.test(v.name)) return 'female';
  if (MALE_RE.test(v.name)) return 'male';
  return 'unknown';
}

/** 依題目 id 產生穩定種子,讓同一題永遠是同一位講者、不同題輪換 */
export function hashSeed(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 挑語音:male/female 給對話的兩個角色;any 讓各題輪換不同講者。
 * 裝置只有一種英文語音時回傳同一個(呼叫端用音高區分)。
 */
export function pickVoice(kind: 'male' | 'female' | 'any', seed = 0): SpeechSynthesisVoice | undefined {
  if (enVoices.length === 0) refreshVoices();
  if (enVoices.length === 0) return undefined;
  const fem = enVoices.filter((v) => voiceGender(v) === 'female');
  const mal = enVoices.filter((v) => voiceGender(v) === 'male');
  const unk = enVoices.filter((v) => voiceGender(v) === 'unknown');
  if (kind === 'female') {
    return fem[seed % Math.max(1, fem.length)] ?? unk[1] ?? enVoices[enVoices.length - 1];
  }
  if (kind === 'male') {
    return mal[seed % Math.max(1, mal.length)] ?? unk[0] ?? enVoices[0];
  }
  return enVoices[seed % enVoices.length];
}

/**
 * TTS 朗讀:cancel 後立刻 speak 在部分引擎會吃掉第一個字,
 * 統一延遲一拍再起音。可指定語音(聽力多聲線用)。
 */
export function speakEn(
  text: string,
  rate = 0.9,
  onend?: () => void,
  voice?: SpeechSynthesisVoice
): void {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang ?? 'en-US';
    if (voice) u.voice = voice;
    u.rate = rate;
    if (onend) u.onend = onend;
    setTimeout(() => speechSynthesis.speak(u), 180);
  } catch {
    /* 瀏覽器不支援就算了 */
  }
}
