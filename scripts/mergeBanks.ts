/** 把 seeds/ext/*.json 的擴充題合併進三個主題庫檔,每型截到 100 題
 *  執行:npx tsx scripts/mergeBanks.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { validators } from '../server/bankValidate.ts';

const SEEDS = path.resolve(import.meta.dirname ?? '.', '../seeds');
const EXT = path.join(SEEDS, 'ext');
const CAP = 100;

// ext 檔名前綴 → (主檔, 主檔內的陣列 key, 驗證器 qtype)
const MAP: Record<string, { file: string; key: string; qtype: string }> = {
  ctw: { file: 'bank_reading.json', key: 'ctw', qtype: 'ctw' },
  daily: { file: 'bank_reading.json', key: 'daily_life', qtype: 'daily_life' },
  academic: { file: 'bank_reading.json', key: 'academic', qtype: 'academic' },
  lcr: { file: 'bank_listening.json', key: 'lcr', qtype: 'lcr' },
  conv: { file: 'bank_listening.json', key: 'conversation', qtype: 'conversation' },
  ann: { file: 'bank_listening.json', key: 'announcement', qtype: 'announcement' },
  talk: { file: 'bank_listening.json', key: 'talk', qtype: 'talk' },
  bs: { file: 'bank_writing_speaking.json', key: 'build_sentence', qtype: 'build_sentence' },
  lnr: { file: 'bank_writing_speaking.json', key: 'lnr_sets', qtype: 'lnr_set' },
};

type Item = Record<string, unknown> & { id: string };

const banks: Record<string, Record<string, Item[]>> = {};
function loadBank(file: string): Record<string, Item[]> {
  if (!banks[file]) banks[file] = JSON.parse(fs.readFileSync(path.join(SEEDS, file), 'utf8'));
  return banks[file];
}

let added = 0;
let dropped = 0;
const dropReasons: string[] = [];

const extFiles = fs.existsSync(EXT) ? fs.readdirSync(EXT).filter((f) => f.endsWith('.json')).sort() : [];
for (const f of extFiles) {
  const prefix = Object.keys(MAP).find((p) => f.startsWith(p + '_'));
  if (!prefix) {
    console.warn(`略過未知檔名 ${f}`);
    continue;
  }
  const { file, key, qtype } = MAP[prefix];
  const bank = loadBank(file);
  if (!Array.isArray(bank[key])) bank[key] = [];
  const seen = new Set(bank[key].map((x) => x.id));
  let payload: { items?: Item[] };
  try {
    payload = JSON.parse(fs.readFileSync(path.join(EXT, f), 'utf8'));
  } catch (e) {
    console.error(`✗ ${f} JSON 解析失敗:${(e as Error).message}`);
    continue;
  }
  const v = validators[qtype];
  for (const item of payload.items ?? []) {
    if (!item?.id || seen.has(item.id)) {
      dropped++;
      dropReasons.push(`${f}:${item?.id ?? '?'} 重複或缺 id`);
      continue;
    }
    const err = v ? v(item) : null;
    if (err) {
      dropped++;
      dropReasons.push(`${f}:${item.id} ${err}`);
      continue;
    }
    if (bank[key].length >= CAP) continue; // 已滿
    bank[key].push(item);
    seen.add(item.id);
    added++;
  }
}

for (const [file, data] of Object.entries(banks)) {
  fs.writeFileSync(path.join(SEEDS, file), JSON.stringify(data, null, 1) + '\n');
}

console.log(`合併完成:新增 ${added} 題,淘汰 ${dropped} 題`);
if (dropReasons.length > 0) {
  console.log('淘汰原因(前 15):');
  for (const r of dropReasons.slice(0, 15)) console.log('  -', r);
}
console.log('---各型現況---');
for (const { file, key, qtype } of Object.values(MAP)) {
  const n = loadBank(file)[key]?.length ?? 0;
  console.log(`${qtype.padEnd(16)} ${n}${n >= CAP ? ' ✓滿' : `(還缺 ${CAP - n})`}`);
}
