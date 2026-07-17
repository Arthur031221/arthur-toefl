/** 瀏覽器端口說三指標(網頁版用,取代伺服器 ffmpeg) */

export interface ClientAnalysis {
  duration: number;
  deadAirCount: number;
  voicedSeconds: number;
}

export async function analyzeBlob(blob: Blob): Promise<ClientAnalysis> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await blob.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const sr = audio.sampleRate;
    const win = Math.max(1, Math.floor(sr * 0.05)); // 50ms 視窗
    const rms: number[] = [];
    for (let i = 0; i < data.length; i += win) {
      let sum = 0;
      const end = Math.min(i + win, data.length);
      for (let j = i; j < end; j++) sum += data[j] * data[j];
      rms.push(Math.sqrt(sum / (end - i)));
    }
    const peak = Math.max(...rms, 0.001);
    const threshold = Math.max(0.006, peak * 0.06); // 自適應靜音門檻

    // 靜音區段(≥0.5 秒),死寂 = ≥3 秒
    const winSec = win / sr;
    let deadAirCount = 0;
    let totalSilence = 0;
    let run = 0;
    const flush = () => {
      const sec = run * winSec;
      if (sec >= 0.5) {
        totalSilence += sec;
        if (sec >= 3) deadAirCount++;
      }
      run = 0;
    };
    for (const v of rms) {
      if (v < threshold) run++;
      else flush();
    }
    flush();

    const duration = data.length / sr;
    return {
      duration: Math.round(duration * 10) / 10,
      deadAirCount,
      voicedSeconds: Math.round(Math.max(0, duration - totalSilence) * 10) / 10,
    };
  } finally {
    void ctx.close();
  }
}
