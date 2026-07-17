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

/**
 * TTS 朗讀:cancel 後立刻 speak 在部分引擎會吃掉第一個字,
 * 統一延遲一拍再起音。
 */
export function speakEn(text: string, rate = 0.9, onend?: () => void): void {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    if (onend) u.onend = onend;
    setTimeout(() => speechSynthesis.speak(u), 180);
  } catch {
    /* 瀏覽器不支援就算了 */
  }
}
