import IORedis from 'ioredis';

export const redisConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('error', (err) => {
  console.error('[redis] Connection error:', err.message);
});

redisConnection.on('connect', () => {
  console.log('[redis] Connected');
});
