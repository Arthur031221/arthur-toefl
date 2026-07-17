import { execFile } from 'node:child_process';

export interface AudioAnalysis {
  duration: number; // 總時長(秒)
  deadAirCount: number; // ≥3 秒死寂次數
  voicedSeconds: number; // 實際發聲秒數
  silences: { start: number; end: number; dur: number }[];
}

const SILENCE_DB = '-35dB';
const MIN_SILENCE = 0.5; // 細粒度偵測,發聲秒數用
const DEAD_AIR_SEC = 3.0; // 死寂門檻

/** 用 ffmpeg silencedetect 算口說三指標 */
export function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-nostdin', '-i', filePath, '-af', `silencedetect=noise=${SILENCE_DB}:d=${MIN_SILENCE}`, '-f', 'null', '-'],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err && !stderr) {
          return reject(new Error(`ffmpeg 分析失敗:${err.message}`));
        }
        try {
          resolve(parseFfmpegOutput(stderr));
        } catch (e) {
          reject(new Error(`ffmpeg 輸出解析失敗:${(e as Error).message}`));
        }
      }
    );
  });
}

export function parseFfmpegOutput(stderr: string): AudioAnalysis {
  // 總時長:取最後一個 time=HH:MM:SS.cc(解碼進度,對 MediaRecorder 的 webm 也可靠)
  let duration = 0;
  const timeMatches = stderr.match(/time=(\d+):(\d+):(\d+\.?\d*)/g);
  if (timeMatches && timeMatches.length > 0) {
    const last = timeMatches[timeMatches.length - 1];
    const m = last.match(/time=(\d+):(\d+):(\d+\.?\d*)/)!;
    duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  // 後備:metadata 的 Duration
  if (duration === 0) {
    const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (dm) duration = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
  }

  // 靜音區間
  const silences: { start: number; end: number; dur: number }[] = [];
  const startRe = /silence_start:\s*(-?\d+\.?\d*)/g;
  const endRe = /silence_end:\s*(-?\d+\.?\d*)\s*\|\s*silence_duration:\s*(\d+\.?\d*)/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(stderr))) starts.push(Math.max(0, Number(m[1])));
  const ends: { end: number; dur: number }[] = [];
  while ((m = endRe.exec(stderr))) ends.push({ end: Number(m[1]), dur: Number(m[2]) });

  for (let i = 0; i < starts.length; i++) {
    if (i < ends.length) {
      silences.push({ start: starts[i], end: ends[i].end, dur: ends[i].dur });
    } else {
      // 收尾沒偵測到 silence_end → 靜音到檔尾
      const dur = Math.max(0, duration - starts[i]);
      silences.push({ start: starts[i], end: duration, dur });
    }
  }

  const totalSilence = silences.reduce((s, x) => s + x.dur, 0);
  const deadAirCount = silences.filter((s) => s.dur >= DEAD_AIR_SEC).length;
  const voicedSeconds = Math.max(0, duration - totalSilence);

  return {
    duration: round1(duration),
    deadAirCount,
    voicedSeconds: round1(voicedSeconds),
    silences: silences.map((s) => ({ start: round1(s.start), end: round1(s.end), dur: round1(s.dur) })),
  };
}

/** 扣掉錄音器提前偷跑的秒數(lead),讓指標以「正式開始」為 0 秒 */
export function shiftAnalysis(a: AudioAnalysis, lead: number): AudioAnalysis {
  if (!lead || lead <= 0) return a;
  const duration = Math.max(0, a.duration - lead);
  const silences = a.silences
    .map((s) => ({ start: Math.max(0, s.start - lead), end: s.end - lead }))
    .filter((s) => s.end > 0.05)
    .map((s) => ({ start: round1(s.start), end: round1(s.end), dur: round1(s.end - s.start) }));
  const totalSilence = silences.reduce((sum, s) => sum + s.dur, 0);
  return {
    duration: round1(duration),
    deadAirCount: silences.filter((s) => s.dur >= DEAD_AIR_SEC).length,
    voicedSeconds: round1(Math.max(0, duration - totalSilence)),
    silences,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
