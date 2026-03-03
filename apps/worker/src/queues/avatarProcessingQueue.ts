import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QUEUE_NAMES, type QueueName } from '@adavatar/utils';
import { JOB_OPTIONS } from '@adavatar/config';

function createQueue(name: QueueName) {
  return new Queue(name, {
    connection: redisConnection,
    skipVersionCheck: true,
    defaultJobOptions: {
      attempts: JOB_OPTIONS.ATTEMPTS,
      backoff: JOB_OPTIONS.BACKOFF,
      removeOnComplete: JOB_OPTIONS.REMOVE_ON_COMPLETE,
      removeOnFail: JOB_OPTIONS.REMOVE_ON_FAIL,
    },
  });
}

export const avatarProcessingQueue = createQueue(QUEUE_NAMES.AVATAR_PROCESSING);

// Ad generation uses more attempts and a longer backoff than other queues because
// Kie.ai's Sora 2 upstream frequently times out with 500 errors. Retrying too
// quickly just hits the same overloaded backend — 60s base gives it time to recover.
// 5 attempts = 4 retries: delays of 60s → 120s → 240s → 480s (exponential).
export const adGenerationQueue = new Queue(QUEUE_NAMES.AD_GENERATION, {
  connection: redisConnection,
  skipVersionCheck: true,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 60_000 },
    removeOnComplete: JOB_OPTIONS.REMOVE_ON_COMPLETE,
    removeOnFail: JOB_OPTIONS.REMOVE_ON_FAIL,
  },
});

export const socialPublishingQueue = createQueue(QUEUE_NAMES.SOCIAL_PUBLISHING);
