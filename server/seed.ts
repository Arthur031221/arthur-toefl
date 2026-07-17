import fs from 'node:fs';
import path from 'node:path';
import { db, SEEDS_DIR, setSetting } from './db.ts';

const SEED_VERSION = '1';
/** 種子錯誤本回填日期(避免灌爆「本週新增」計數) */
const SEED_BACKDATE = '2026-07-10';

function readSeed<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, name), 'utf8')) as T;
}

export function seedIfNeeded(): void {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'seed_version'").get() as
    | { value: string }
    | undefined;
  if (row?.value === SEED_VERSION) return;

  console.log('[seed] 首次啟動:載入種子資料...');
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // ---- 附錄 A:65 天計畫 ----
    const plan = readSeed<
      { date: string; dow: string; phase: string; type: string; videos: string[]; main: string; special: string }[]
    >('plan.json');
    const insPlan = db.prepare(
      'INSERT OR REPLACE INTO plan_days (date, dow, phase, type, videos, main, special) VALUES (?,?,?,?,?,?,?)'
    );
    for (const d of plan) {
      insPlan.run(d.date, d.dow, d.phase, d.type, JSON.stringify(d.videos), d.main, d.special);
    }

    // ---- 附錄 B-1:影片(66 部),排定日期由計畫反查 ----
    const scheduled = new Map<string, string>();
    for (const d of plan) {
      for (const code of d.videos) {
        if (!scheduled.has(code)) scheduled.set(code, d.date);
      }
    }
    const videosSeed = readSeed<{
      課程: {
        course: string;
        speed: string;
        done_target: string;
        videos: { code: string; title: string; dur: string; status?: string; note?: string }[];
      }[];
    }>('videos.json');
    const insVideo = db.prepare(
      `INSERT OR REPLACE INTO videos (code, course, title, dur, speed, done_target, scheduled_date, note, tips, done, done_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const course of videosSeed['課程']) {
      for (const v of course.videos) {
        const done = v.status === 'done' ? 1 : 0;
        insVideo.run(
          v.code,
          course.course,
          v.title,
          v.dur,
          course.speed,
          course.done_target,
          scheduled.get(v.code) ?? '',
          v.note ?? '',
          done ? '(平台建置前已完成)' : '',
          done,
          done ? SEED_BACKDATE : ''
        );
      }
    }

    // ---- 附錄 B-2:Flex 配額 ----
    const quota = readSeed<
      { item: string; total: number; used: number; reserve?: number; rule?: string; planned?: string[] }[]
    >('quota.json');
    const insQuota = db.prepare(
      'INSERT OR REPLACE INTO quota (item, total, used, reserve, rule, planned) VALUES (?,?,?,?,?,?)'
    );
    for (const q of quota) {
      insQuota.run(q.item, q.total, q.used, q.reserve ?? 0, q.rule ?? '', JSON.stringify(q.planned ?? []));
    }

    // ---- 附錄 C:錯誤本 ----
    const errors = readSeed<{ cat: string; wrong: string; correct: string; note: string }[]>('errors.json');
    const insErr = db.prepare(
      "INSERT INTO error_book (cat, wrong, correct, note, source, created_at) VALUES (?,?,?,?,'種子',?)"
    );
    for (const e of errors) insErr.run(e.cat, e.wrong, e.correct, e.note, SEED_BACKDATE + 'T00:00:00.000Z');

    // ---- 附錄 C:拼寫詞庫 ----
    const spelling = readSeed<{ personal: { word: string; hint: string }[]; academic: { word: string; hint: string }[] }>(
      'spelling.json'
    );
    const insWord = db.prepare(
      'INSERT OR IGNORE INTO spelling_words (word, grp, hint, created_at) VALUES (?,?,?,?)'
    );
    for (const w of spelling.personal) insWord.run(w.word, 'personal', w.hint, now);
    for (const w of spelling.academic) insWord.run(w.word, 'academic', w.hint, now);

    // ---- 附錄 D:Interview 題庫 ----
    const questions = readSeed<string[]>('interview_questions.json');
    const insQ = db.prepare("INSERT INTO interview_questions (text, source, created_at) VALUES (?,'seed',?)");
    for (const q of questions) insQ.run(q, now);

    // ---- 附錄 D:寫作題庫 ----
    const prompts = readSeed<{ kind: string; title: string; prompt: string }[]>('writing_prompts.json');
    const insP = db.prepare(
      "INSERT INTO writing_prompts (kind, title, prompt, source, created_at) VALUES (?,?,?,'seed',?)"
    );
    for (const p of prompts) insP.run(p.kind, p.title, p.prompt, now);

    // ---- 附錄 F:AI 批改 prompt 模板 ----
    const templates = readSeed<Record<string, { title: string; template: string }>>('ai_templates.json');
    const insT = db.prepare(
      'INSERT OR REPLACE INTO ai_templates (key, title, template, default_template) VALUES (?,?,?,?)'
    );
    for (const [key, t] of Object.entries(templates)) insT.run(key, t.title, t.template, t.template);

    // ---- 附錄 G:資源連結牆 ----
    const links = readSeed<{ name: string; url: string; when: string }[]>('links.json');
    const insL = db.prepare('INSERT INTO links (name, url, whenuse) VALUES (?,?,?)');
    db.prepare('DELETE FROM links').run();
    for (const l of links) insL.run(l.name, l.url, l.when);

    // ---- 附錄 H:方法卡 ----
    const methods = readSeed<{ title: string; body: string }[]>('methods.json');
    const insM = db.prepare('INSERT INTO methods (title, body) VALUES (?,?)');
    db.prepare('DELETE FROM methods').run();
    for (const m of methods) insM.run(m.title, m.body);

    // ---- 預設設定 ----
    setSetting('ai_provider', 'cli');
    setSetting('anthropic_model', process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6');
    setSetting('whisper_model', 'base');

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)").run(SEED_VERSION);
  });

  tx();
  console.log('[seed] 種子資料載入完成 ✓');
}

/** 種子新增的模板 key 補進既有 DB(不動既存內容) */
export function ensureNewTemplates(): void {
  const seedTpls = readSeed<Record<string, { title: string; template: string }>>('ai_templates.json');
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ai_templates (key, title, template, default_template) VALUES (?,?,?,?)'
  );
  for (const [key, t] of Object.entries(seedTpls)) {
    const r = ins.run(key, t.title, t.template, t.template);
    if (r.changes > 0) console.log(`[migrate] 新模板 ${key} 已加入 ✓`);
  }
}

/** 一次性遷移:AI 模板加入 score100 百分制(讀 seeds 為單一事實來源) */
export function migrateTemplatesScore100(): void {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'tpl_score100_v1'").get();
  if (done) return;
  const seedTpls = readSeed<Record<string, { title: string; template: string }>>('ai_templates.json');
  const tx = db.transaction(() => {
    for (const key of ['grade_email', 'grade_discussion', 'speaking_feedback']) {
      const seed = seedTpls[key];
      if (!seed) continue;
      const cur = db
        .prepare('SELECT template, default_template FROM ai_templates WHERE key = ?')
        .get(key) as { template: string; default_template: string } | undefined;
      if (!cur) continue;
      if (cur.template === cur.default_template) {
        // 使用者沒改過 → 直接換新版
        db.prepare('UPDATE ai_templates SET template = ?, default_template = ? WHERE key = ?').run(
          seed.template,
          seed.template,
          key
        );
      } else {
        // 使用者自訂過 → 只更新「還原預設」的目標,不動自訂內容
        db.prepare('UPDATE ai_templates SET default_template = ? WHERE key = ?').run(seed.template, key);
      }
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tpl_score100_v1','1')").run();
  });
  tx();
  console.log('[migrate] AI 模板已加入百分制 score100 ✓');
}

/** 內建 TTS 聽寫句庫(瀏覽器朗讀,不需音檔) */
export function seedTtsPacks(): void {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'seed_tts_v1'").get() as
    | { value: string }
    | undefined;
  if (row) return;
  const now = new Date().toISOString();
  const packs: { title: string; note: string; sentences: string[] }[] = [
    {
      title: '內建|Announcement 校園廣播風(TTS)',
      note: '對應 Flex Announcement 弱點題型;練四欄位:什麼事/原本/改成/要你做什麼',
      sentences: [
        'Attention all students: the library will close at nine tonight instead of eleven due to a system upgrade.',
        'The chemistry lecture originally scheduled for Tuesday has been moved to Thursday at two in Room 304.',
        'Starting next Monday, the campus shuttle will depart every twenty minutes rather than every fifteen.',
        'The registration deadline for spring courses has been extended from Friday to next Wednesday at noon.',
        'Due to construction, the north entrance of the student center will be closed until the end of March.',
        'All dining halls will offer extended hours during final exam week, staying open until midnight.',
        'The career fair has been relocated from the gymnasium to the main auditorium on the second floor.',
        'Students who wish to change their meal plan must submit a request form by this Saturday.',
      ],
    },
    {
      title: '內建|Conversation 校園對話風(TTS)',
      note: '日常校園對話常速句;練連音與弱讀',
      sentences: [
        "I was going to sign up for the photography club, but the meeting time conflicts with my lab.",
        "Could you tell me where I can pick up my student ID card? I was told it would be ready today.",
        "Professor Miller said we could hand in the draft a couple of days late if we email her first.",
        "I've been looking for a quiet place to study, but the library is completely packed this week.",
        "You should have seen the line at the bookstore; it took me almost an hour to buy one textbook.",
        "If I were you, I would talk to your advisor before dropping the statistics course.",
        "We're supposed to meet at the coffee shop across from the dorm at half past four.",
        "I didn't realize the gym required a reservation now, so I had to come back later in the evening.",
      ],
    },
    {
      title: '內建|Academic Talk 學術短講風(TTS)',
      note: '學術詞彙+長句;練語速與生字',
      sentences: [
        'Photosynthesis is the process by which plants convert sunlight, water, and carbon dioxide into energy.',
        'The industrial revolution fundamentally changed how goods were produced and distributed across Europe.',
        'Researchers found that students who slept eight hours performed significantly better on memory tasks.',
        'Urban planners must balance economic development with the preservation of green public spaces.',
        'The migration patterns of these birds are influenced by temperature, food supply, and daylight hours.',
        'Ancient civilizations developed irrigation systems to support agriculture in extremely dry regions.',
        'The professor argued that language acquisition depends heavily on early childhood exposure.',
        'Renewable energy sources such as wind and solar now account for a growing share of electricity production.',
      ],
    },
  ];
  const ins = db.prepare(
    "INSERT INTO dictation_materials (title, kind, audio_path, transcript, source_note, created_at) VALUES (?,'tts','',?,?,?)"
  );
  const tx = db.transaction(() => {
    for (const p of packs) ins.run(p.title, p.sentences.join('\n'), p.note, now);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_tts_v1','1')").run();
  });
  tx();
  console.log('[seed] TTS 聽寫句庫載入完成 ✓');
}
