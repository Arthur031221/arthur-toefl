/** 字詞級 diff(瀏覽器版,與 server/diff.ts 邏輯一致;網頁版跟讀評分用) */
import type { DiffOp } from './types';

export function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9'’]+(?:-[A-Za-z0-9'’]+)*/g) || [];
}

function norm(t: string): string {
  return t.toLowerCase().replace(/’/g, "'");
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function diffWords(refText: string, hypText: string): { ops: DiffOp[]; accuracy: number } {
  const ref = tokenize(refText);
  const hyp = tokenize(hypText);
  const m = ref.length;
  const n = hyp.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const eq = norm(ref[i - 1]) === norm(hyp[j - 1]) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + eq, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] && norm(ref[i - 1]) === norm(hyp[j - 1])) {
      ops.push({ type: 'equal', ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      const r = ref[i - 1];
      const h = hyp[j - 1];
      const close = levenshtein(norm(r), norm(h)) <= Math.max(1, Math.floor(r.length / 4));
      ops.push({ type: 'sub', ref: r, hyp: h, close });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'del', ref: ref[i - 1] });
      i--;
    } else {
      ops.push({ type: 'ins', hyp: hyp[j - 1] });
      j--;
    }
  }
  ops.reverse();
  const correct = ops.filter((o) => o.type === 'equal').length;
  const accuracy = m > 0 ? Math.round((correct / m) * 1000) / 10 : 0;
  return { ops, accuracy };
}

export function shadowScoreLocal(target: string, transcript: string) {
  const { ops, accuracy } = diffWords(target, transcript);
  const unclear = ops
    .filter((o) => (o.type === 'del' || o.type === 'sub') && (o.ref ?? '').length > 0)
    .map((o) => ({ word: o.ref!, heard: o.type === 'sub' ? (o.hyp ?? '') : '' }));
  return { transcript, accuracy: Math.round(accuracy), unclear, ops };
}
