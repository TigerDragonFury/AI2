import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@adavatar/utils';
import { JOB_OPTIONS } from '@adavatar/config';
import IORedis from 'ioredis';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const avatarProcessingQueue = new Queue(QUEUE_NAMES.AVATAR_PROCESSING, {
  connection: redisConnection,
  defaultJobOptions: JOB_OPTIONS,
});

export const adGenerationQueue = new Queue(QUEUE_NAMES.AD_GENERATION, {
  connection: redisConnection,
  defaultJobOptions: JOB_OPTIONS,
});

export const socialPublishingQueue = new Queue(QUEUE_NAMES.SOCIAL_PUBLISHING, {
  connection: redisConnection,
  defaultJobOptions: JOB_OPTIONS,
});
