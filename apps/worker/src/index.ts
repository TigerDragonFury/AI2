import 'dotenv/config';
import * as Sentry from '@sentry/node';
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
import { runMonthlyResetCron } from './crons/monthlyReset';

import { ANALYTICS_CRON, TOKEN_REFRESH_CRON, MONTHLY_RESET_CRON } from '@adavatar/config';
import { redisConnection } from './lib/redis';

// ─── Sentry ───────────────────────────────────────────────────────────────────
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  environment: process.env.NODE_ENV ?? 'development',
});

// ─── Bull Board UI ────────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(avatarProcessingQueue) as never,
    new BullMQAdapter(adGenerationQueue) as never,
    new BullMQAdapter(socialPublishingQueue) as never,
  ],
  serverAdapter,
  options: {
    // Increase UI auto-refresh from ~5 s default to 30 s to reduce Redis reads
    // triggered by the browser polling the Bull Board Express endpoints.
    uiConfig: { pollingInterval: { forceInterval: 30_000 } },
  },
});

const app = express();
app.use('/admin/queues', serverAdapter.getRouter());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── Kie.ai stalled-task admin ────────────────────────────────────────────────
// Simple password guard — set WORKER_ADMIN_SECRET in Render env vars.
// If not set the routes are open (acceptable behind Render's private network).
function requireAdminSecret(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const secret = process.env.WORKER_ADMIN_SECRET;
  if (!secret) return next(); // no secret configured — open
  if (req.query.secret === secret || req.body?.secret === secret) return next();
  res.status(401).send('Unauthorized — append ?secret=YOUR_SECRET to the URL');
}

/** Scan Redis for all kie:pendingTask:* keys and return { adId, taskId }[] */
async function listKieTasks(): Promise<{ adId: string; taskId: string }[]> {
  const keys = await redisConnection.keys('kie:pendingTask:*');
  if (!keys.length) return [];
  const values = await redisConnection.mget(...keys);
  return keys.map((k, i) => ({
    adId: k.replace('kie:pendingTask:', ''),
    taskId: values[i] ?? '(missing)',
  }));
}

app.get('/admin/kie-tasks', requireAdminSecret, async (_req, res) => {
  try {
    const tasks = await listKieTasks();
    const secretParam = process.env.WORKER_ADMIN_SECRET
      ? `?secret=${process.env.WORKER_ADMIN_SECRET}`
      : '';
    const rows = tasks.length
      ? tasks
          .map(
            ({ adId, taskId }) => `
          <tr>
            <td style="padding:8px 12px;font-family:monospace">${adId}</td>
            <td style="padding:8px 12px;font-family:monospace">${taskId}</td>
            <td style="padding:8px 12px">
              <form method="POST" action="/admin/kie-tasks/${adId}/resume${secretParam}" style="display:inline">
                <button style="background:#22c55e;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer">▶ Resume</button>
              </form>
              &nbsp;
              <form method="POST" action="/admin/kie-tasks/${adId}/discard${secretParam}" style="display:inline"
                    onsubmit="return confirm('Discard task ${taskId}?')">
                <button style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer">✕ Discard</button>
              </form>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="3" style="padding:16px;text-align:center;color:#888">No stalled Kie.ai tasks</td></tr>';

    res.send(`<!DOCTYPE html>
<html>
<head><title>Kie.ai Stalled Tasks</title>
<meta http-equiv="refresh" content="15">
<style>body{font-family:sans-serif;margin:32px;background:#0f0f0f;color:#e5e5e5}
h1{font-size:1.4rem;margin-bottom:4px}p{color:#888;font-size:.85rem;margin-bottom:24px}
table{border-collapse:collapse;width:100%;background:#1a1a1a;border-radius:8px;overflow:hidden}
th{background:#262626;padding:10px 12px;text-align:left;font-size:.8rem;color:#aaa;text-transform:uppercase;letter-spacing:.05em}
tr:not(:last-child){border-bottom:1px solid #2a2a2a}
a{color:#60a5fa;text-decoration:none}</style>
</head>
<body>
<h1>🎬 Kie.ai Stalled Tasks</h1>
<p>Auto-refreshes every 15 s &nbsp;·&nbsp; <a href="/admin/queues${secretParam}">← Bull Board</a></p>
<table>
  <thead><tr><th>Ad ID</th><th>Kie.ai Task ID</th><th>Actions</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.post('/admin/kie-tasks/:adId/resume', requireAdminSecret, async (req, res) => {
  const { adId } = req.params;
  const secretParam = process.env.WORKER_ADMIN_SECRET
    ? `?secret=${process.env.WORKER_ADMIN_SECRET}`
    : '';
  try {
    const taskId = await redisConnection.get(`kie:pendingTask:${adId}`);
    if (!taskId) {
      return res.send(
        `<p>No pending task found for ad <code>${adId}</code>. It may have already completed or been discarded.</p><a href="/admin/kie-tasks${secretParam}">← Back</a>`
      );
    }
    // Re-add to BullMQ — worker will find the Redis key and resume polling.
    // Use a stable jobId so BullMQ deduplicates: if a job for this adId is
    // already waiting or active, no second job is created (avoids two concurrent
    // workers racing to consume the same Redis key).
    await adGenerationQueue.add('generate-ad', { adId }, { jobId: `resume:${adId}` });
    console.log(`[admin] Manually resumed Kie.ai task ${taskId} for ad ${adId}`);
    res.redirect(`/admin/kie-tasks${secretParam}`);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.post('/admin/kie-tasks/:adId/discard', requireAdminSecret, async (req, res) => {
  const { adId } = req.params;
  const secretParam = process.env.WORKER_ADMIN_SECRET
    ? `?secret=${process.env.WORKER_ADMIN_SECRET}`
    : '';
  try {
    await redisConnection.del(`kie:pendingTask:${adId}`);
    console.log(`[admin] Discarded Kie.ai resume key for ad ${adId}`);
    res.redirect(`/admin/kie-tasks${secretParam}`);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

const PORT = process.env.PORT ?? process.env.WORKER_PORT ?? 4001;
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

cron.schedule(MONTHLY_RESET_CRON, () => {
  console.log('[cron] Running monthly usage reset');
  runMonthlyResetCron().catch(console.error);
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
