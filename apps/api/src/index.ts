import 'dotenv/config';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { router } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

// ─── Process-level error guards ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
});

// ─── Sentry ───────────────────────────────────────────────────────────────────
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  environment: process.env.NODE_ENV ?? 'development',
});

const app = express();
const PORT = process.env.PORT ?? 4000;

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(helmet());
const ALLOWED_ORIGINS = [
  process.env.WEB_BASE_URL,
  process.env.NEXTAUTH_URL,
  'https://ai-2-web.vercel.app',
  'http://localhost:3000',
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', router);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
  console.log(`[api] NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`[api] ALLOWED_ORIGINS=${JSON.stringify(ALLOWED_ORIGINS)}`);
  console.log(`[api] DATABASE_URL set=${!!process.env.DATABASE_URL}`);
  console.log(`[api] DIRECT_URL set=${!!process.env.DIRECT_URL}`);
  console.log(`[api] API_JWT_SECRET set=${!!process.env.API_JWT_SECRET}`);
  console.log(`[api] REDIS_URL set=${!!process.env.REDIS_URL}`);
});

process.on('SIGTERM', () => {
  console.log('[api] SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('[api] Server closed');
    process.exit(0);
  });
});

export default app;
