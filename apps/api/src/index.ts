import 'dotenv/config';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { router } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

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
app.use(
  cors({
    origin: process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
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
});

process.on('SIGTERM', () => {
  console.log('[api] SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('[api] Server closed');
    process.exit(0);
  });
});

export default app;
