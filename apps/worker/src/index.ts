import 'dotenv/config';
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cron from 'node-cron';

import { avatarProcessingQueue } from './queues/avatarProcessingQueue';
import { adGenerationQueue } from './queues/adGenerationQueue';
import { socialPublishingQueue } from './queues/socialPublishingQueue';

import { avatarProcessingWorker } from './workers/avatarProcessingWorker';
import { adGenerationWorker } from './workers/adGenerationWorker';
import { socialPublishingWorker } from './workers/socialPublishingWorker';

import { runTokenRefreshCron } from './crons/tokenRefresh';
import { runAnalyticsIngestionCron } from './crons/analyticsIngestion';

import { ANALYTICS_CRON, TOKEN_REFRESH_CRON } from '@adavatar/config';

// ─── Bull Board UI ────────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(avatarProcessingQueue),
    new BullMQAdapter(adGenerationQueue),
    new BullMQAdapter(socialPublishingQueue),
  ],
  serverAdapter,
});

const app = express();
app.use('/admin/queues', serverAdapter.getRouter());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.WORKER_PORT ?? 4001;
app.listen(PORT, () => {
  console.log(`[worker] Bull Board available at http://localhost:${PORT}/admin/queues`);
});

// ─── Start workers ────────────────────────────────────────────────────────────
console.log('[worker] Starting avatar processing worker...');
avatarProcessingWorker;

console.log('[worker] Starting ad generation worker...');
adGenerationWorker;

console.log('[worker] Starting social publishing worker...');
socialPublishingWorker;

// ─── Cron jobs ────────────────────────────────────────────────────────────────
cron.schedule(TOKEN_REFRESH_CRON, () => {
  console.log('[cron] Running token refresh');
  runTokenRefreshCron().catch(console.error);
});

cron.schedule(ANALYTICS_CRON, () => {
  console.log('[cron] Running analytics ingestion');
  runAnalyticsIngestionCron().catch(console.error);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  console.log('[worker] Shutting down workers...');
  await Promise.all([
    avatarProcessingWorker.close(),
    adGenerationWorker.close(),
    socialPublishingWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
