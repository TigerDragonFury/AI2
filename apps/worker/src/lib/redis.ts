import IORedis from 'ioredis';

export const redisConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  // Retry indefinitely with exponential backoff (cap 10s) + jitter.
  // This ensures workers survive Render Redis upgrades/restarts without
  // permanently losing the connection.
  retryStrategy: (times) => {
    const base = Math.min(times * 500, 10_000);
    const jitter = Math.floor(Math.random() * 1000);
    return base + jitter;
  },
  // Queue commands while disconnected — critical for BullMQ lock renewals
  // during a transient Redis restart (otherwise renewals throw and jobs stall).
  enableOfflineQueue: true,
  // Reconnect on READONLY errors that occur during Redis primary failover.
  reconnectOnError: (err) => {
    const msg = err.message.toUpperCase();
    return msg.includes('READONLY') || msg.includes('LOADING');
  },
  // Keep the TCP connection alive to detect drops quickly.
  keepAlive: 10_000,
  connectTimeout: 20_000,
});

redisConnection.on('error', (err) => {
  console.error('[redis] Connection error:', err.message);
});

redisConnection.on('connect', () => {
  console.log('[redis] Connected');
});

redisConnection.on('reconnecting', () => {
  console.log('[redis] Reconnecting…');
});
