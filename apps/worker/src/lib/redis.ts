import IORedis from 'ioredis';

export const redisConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 3) {
      console.warn('[redis] Redis unavailable — worker queues disabled');
      return null;
    }
    return Math.min(times * 500, 2000);
  },
  enableOfflineQueue: false,
});

redisConnection.on('error', (err) => {
  console.error('[redis] Connection error:', err.message);
});

redisConnection.on('connect', () => {
  console.log('[redis] Connected');
});
