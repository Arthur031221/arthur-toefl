import { Router } from 'express';
import { db, setSetting } from '../db.ts';
import { getFeedback, testProvider, type FeedbackKind } from '../aiService.ts';

export const aiRouter = Router();

const FEEDBACK_KINDS = new Set<string>([
  'grade_email', 'grade_discussion', 'speaking_feedback',
  'gen_email', 'gen_discussion', 'gen_repeat',
  'gen_ctw', 'gen_daily_life', 'gen_academic', 'gen_lcr',
  'gen_conversation', 'gen_announcement', 'gen_talk', 'gen_build_sentence',
]);

/** 網頁版的 AI 通道:讓 GitHub Pages 版走本機 Claude 訂閱 */
aiRouter.post('/ai/feedback', async (req, res) => {
  const { kind, vars } = req.body as { kind?: string; vars?: Record<string, unknown> };
  if (!kind || !FEEDBACK_KINDS.has(kind)) {
    return res.status(400).json({ error: `不支援的 kind:${kind}` });
  }
  const safeVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (typeof v === 'string' && k.length <= 32) safeVars[k] = v.slice(0, 20000);
  }
  try {
    const r = await getFeedback(kind as FeedbackKind, safeVars);
    res.json({ text: r.text, parsed: r.parsed, provider: r.provider, ms: r.ms });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** prompt 模板列表 */
aiRouter.get('/ai/templates', (_req, res) => {
  res.json(db.prepare('SELECT key, title, template, default_template FROM ai_templates').all());
});

/** 編輯模板 */
aiRouter.put('/ai/templates/:key', (req, res) => {
  const { template } = req.body as { template?: string };
  if (!template || !template.trim()) return res.status(400).json({ error: '模板內容不可為空' });
  const r = db
    .prepare('UPDATE ai_templates SET template = ? WHERE key = ?')
    .run(template, req.params.key);
  if (r.changes === 0) return res.status(404).json({ error: '找不到模板' });
  res.json({ ok: true });
});

/** 還原預設模板 */
aiRouter.post('/ai/templates/:key/reset', (req, res) => {
  const r = db
    .prepare('UPDATE ai_templates SET template = default_template WHERE key = ?')
    .run(req.params.key);
  if (r.changes === 0) return res.status(404).json({ error: '找不到模板' });
  const row = db.prepare('SELECT template FROM ai_templates WHERE key = ?').get(req.params.key);
  res.json({ ok: true, ...row as object });
});

/** provider 切換 */
aiRouter.put('/ai/provider', (req, res) => {
  const { provider, model } = req.body as { provider?: string; model?: string };
  if (provider !== 'cli' && provider !== 'api') {
    return res.status(400).json({ error: 'provider 必須是 cli 或 api' });
  }
  setSetting('ai_provider', provider);
  if (model && model.trim()) setSetting('anthropic_model', model.trim());
  res.json({ ok: true });
});

/** 連線測試 */
aiRouter.post('/ai/test', async (req, res) => {
  const { provider } = req.body as { provider?: 'cli' | 'api' };
  if (provider !== 'cli' && provider !== 'api') {
    return res.status(400).json({ error: 'provider 必須是 cli 或 api' });
  }
  try {
    const r = await testProvider(provider);
    res.json({ ok: true, reply: r.text.slice(0, 100), ms: r.ms, provider: r.provider });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});
