import { Router } from 'express';
import { db, setSetting } from '../db.ts';
import { testProvider } from '../aiService.ts';

export const aiRouter = Router();

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
