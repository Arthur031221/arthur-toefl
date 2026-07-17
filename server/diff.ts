/** 聽寫對答案:字詞級 LCS diff */

export interface DiffOp {
  type: 'equal' | 'sub' | 'del' | 'ins'; // del=漏聽(答案有你沒寫) ins=多寫 sub=寫錯
  ref?: string;
  hyp?: string;
  close?: boolean; // sub 且拼寫接近 → 視為錯字
}

export function tokenize(text: string): string[] {
  return (text.match(/[A-Za-z0-9'’]+(?:-[A-Za-z0-9'’]+)*/g) || []).map((t) => t);
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
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** 對齊 reference(正確逐字稿)與 hypothesis(使用者輸入) */
export function diffWords(refText: string, hypText: string): { ops: DiffOp[]; accuracy: number } {
  const ref = tokenize(refText);
  const hyp = tokenize(hypText);
  const m = ref.length;
  const n = hyp.length;

  // DP:編輯距離路徑(等/替/刪/插)
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
