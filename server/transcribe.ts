import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectWhisper } from './system.ts';
import { getSetting } from './db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'whisper_transcribe.py');

export interface TranscribeResult {
  text: string;
  duration: number;
  segments: { start: number; end: number; text: string }[];
}

/** faster-whisper 本地轉錄(首次執行會下載模型) */
export function whisperTranscribe(audioPath: string): Promise<TranscribeResult> {
  const { level, python } = detectWhisper();
  if (level === 'none') {
    return Promise.reject(
      new Error('本機沒有 faster-whisper。請改用瀏覽器即時轉錄或手動貼逐字稿;安裝方式見 README。')
    );
  }
  const model = getSetting('whisper_model', 'base');
  return new Promise((resolve, reject) => {
    execFile(
      python,
      [SCRIPT, audioPath, model],
      { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (e.killed) return reject(new Error('轉錄逾時(5 分鐘)。首次使用需下載模型,請再試一次。'));
          return reject(new Error(`whisper 轉錄失敗:${(stderr || e.message).slice(-400)}`));
        }
        try {
          const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '') as TranscribeResult & {
            error?: string;
          };
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed);
        } catch {
          reject(new Error(`whisper 輸出解析失敗:${stdout.slice(0, 200)}`));
        }
      }
    );
  });
}
