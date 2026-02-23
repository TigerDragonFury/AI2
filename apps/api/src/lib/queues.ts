import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@adavatar/utils';
import { JOB_OPTIONS } from '@adavatar/config';
import IORedis from 'ioredis';

const silenceError = () => {};

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 2) return null;
    return Math.min(times * 500, 2000);
  },
  enableOfflineQueue: false,
});
redisConnection.on('error', silenceError);

function makeQueue(name: string) {
  const q = new Queue(name, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: JOB_OPTIONS.ATTEMPTS,
      backoff: JOB_OPTIONS.BACKOFF,
      removeOnComplete: JOB_OPTIONS.REMOVE_ON_COMPLETE,
      removeOnFail: JOB_OPTIONS.REMOVE_ON_FAIL,
    },
  });
  q.on('error', silenceError);
  return q;
}

export const avatarProcessingQueue = makeQueue(QUEUE_NAMES.AVATAR_PROCESSING);
export const adGenerationQueue = makeQueue(QUEUE_NAMES.AD_GENERATION);
export const socialPublishingQueue = makeQueue(QUEUE_NAMES.SOCIAL_PUBLISHING);
