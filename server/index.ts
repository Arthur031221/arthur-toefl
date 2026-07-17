import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RECORDINGS_DIR, UPLOADS_DIR, getSetting } from './db.ts';
import { seedIfNeeded, seedTtsPacks, migrateTemplatesScore100, ensureNewTemplates } from './seed.ts';
import { getSystemStatus } from './system.ts';
import { coreRouter } from './routes/core.ts';
import { resourcesRouter } from './routes/resources.ts';
import { aiRouter } from './routes/ai.ts';
import { writingRouter } from './routes/writing.ts';
import { errorsRouter } from './routes/errors.ts';
import { spellingRouter } from './routes/spelling.ts';
import { speakingRouter } from './routes/speaking.ts';
import { repeatRouter } from './routes/repeat.ts';
import { dictationRouter } from './routes/dictation.ts';
import { mockRouter } from './routes/mock.ts';
import { settingsRouter } from './routes/settings.ts';
import { bankRouter, seedBanks } from './routes/bank.ts';

seedIfNeeded();
seedTtsPacks();
migrateTemplatesScore100();
ensureNewTemplates();
seedBanks();

const app = express();
app.use(express.json({ limit: '10mb' }));

// 錄音與上傳素材靜態服務
app.use('/recordings', express.static(RECORDINGS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/system/status', (req, res) => {
  const status = getSystemStatus(req.query.refresh === '1');
  res.json({ ...status, provider: getSetting('ai_provider', 'cli') });
});

app.use('/api', coreRouter);
app.use('/api', resourcesRouter);
app.use('/api', aiRouter);
app.use('/api', writingRouter);
app.use('/api', errorsRouter);
app.use('/api', spellingRouter);
app.use('/api', speakingRouter);
app.use('/api', repeatRouter);
app.use('/api', dictationRouter);
app.use('/api', mockRouter);
app.use('/api', settingsRouter);
app.use('/api', bankRouter);

// 生產模式:服務打包後的前端
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|recordings|uploads).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// 統一錯誤處理:AI/轉錄失敗不吞錯
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server]', err);
    res.status(500).json({ error: err.message || '伺服器內部錯誤' });
  }
);

const PORT = Number(process.env.SERVER_PORT || 3001);
app.listen(PORT, () => {
  console.log(`[server] TOEFL 備戰平台後端 http://localhost:${PORT}`);
});
