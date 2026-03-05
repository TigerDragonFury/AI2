import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@adavatar/utils';
import { JOB_OPTIONS } from '@adavatar/config';
import IORedis from 'ioredis';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (times) => {
    const base = Math.min(times * 500, 10_000);
    return base + Math.floor(Math.random() * 500);
  },
  enableOfflineQueue: true,
  reconnectOnError: (err) => {
    const msg = err.message.toUpperCase();
    return msg.includes('READONLY') || msg.includes('LOADING');
  },
  keepAlive: 10_000,
  connectTimeout: 20_000,
});
redisConnection.on('error', (err) => console.error('[queues] Redis error:', err.message));

function makeQueue(name: string) {
  const q = new Queue(name, {
    connection: redisConnection,
    skipVersionCheck: true,
    defaultJobOptions: {
      attempts: JOB_OPTIONS.ATTEMPTS,
      backoff: JOB_OPTIONS.BACKOFF,
      removeOnComplete: JOB_OPTIONS.REMOVE_ON_COMPLETE,
      removeOnFail: JOB_OPTIONS.REMOVE_ON_FAIL,
    },
  });
  q.on('error', (err) => console.error(`[queue:${name}] error:`, err.message));
  return q;
}

export const avatarProcessingQueue = makeQueue(QUEUE_NAMES.AVATAR_PROCESSING);
export const adGenerationQueue = makeQueue(QUEUE_NAMES.AD_GENERATION);
export const socialPublishingQueue = makeQueue(QUEUE_NAMES.SOCIAL_PUBLISHING);
