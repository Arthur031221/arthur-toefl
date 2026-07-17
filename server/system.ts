import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.ts';

export interface SystemStatus {
  ffmpeg: boolean;
  ffmpegVersion: string;
  whisper: 'venv' | 'system' | 'none';
  whisperPython: string;
  claudeCli: boolean;
  claudeCliVersion: string;
  apiKey: boolean;
  checkedAt: string;
}

let cached: SystemStatus | null = null;

function tryCmd(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 });
    if (r.status === 0) return { ok: true, out: (r.stdout || r.stderr || '').split('\n')[0].trim() };
    return { ok: false, out: '' };
  } catch {
    return { ok: false, out: '' };
  }
}

export function venvPython(): string {
  const p = path.join(ROOT, '.venv', 'bin', 'python');
  const pWin = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(p)) return p;
  if (fs.existsSync(pWin)) return pWin;
  return '';
}

/** 偵測 whisper 可用層級:回傳可用的 python 路徑 */
export function detectWhisper(): { level: 'venv' | 'system' | 'none'; python: string } {
  const venv = venvPython();
  if (venv) {
    const r = tryCmd(venv, ['-c', 'import faster_whisper']);
    if (r.ok) return { level: 'venv', python: venv };
  }
  for (const py of ['python3', 'python']) {
    const r = tryCmd(py, ['-c', 'import faster_whisper']);
    if (r.ok) return { level: 'system', python: py };
  }
  return { level: 'none', python: '' };
}

export function getSystemStatus(refresh = false): SystemStatus {
  if (cached && !refresh) return cached;
  const ffmpeg = tryCmd('ffmpeg', ['-version']);
  const claude = tryCmd('claude', ['--version']);
  const whisper = detectWhisper();
  cached = {
    ffmpeg: ffmpeg.ok,
    ffmpegVersion: ffmpeg.out,
    whisper: whisper.level,
    whisperPython: whisper.python,
    claudeCli: claude.ok,
    claudeCliVersion: claude.out,
    apiKey: !!process.env.ANTHROPIC_API_KEY,
    checkedAt: new Date().toISOString(),
  };
  return cached;
}
