import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QUEUE_NAMES, type QueueName } from '@adavatar/utils';
import { JOB_OPTIONS } from '@adavatar/config';

function createQueue(name: QueueName) {
  return new Queue(name, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: JOB_OPTIONS.ATTEMPTS,
      backoff: JOB_OPTIONS.BACKOFF,
      removeOnComplete: JOB_OPTIONS.REMOVE_ON_COMPLETE,
      removeOnFail: JOB_OPTIONS.REMOVE_ON_FAIL,
    },
  });
}

export const avatarProcessingQueue = createQueue(QUEUE_NAMES.AVATAR_PROCESSING);
export const adGenerationQueue = createQueue(QUEUE_NAMES.AD_GENERATION);
export const socialPublishingQueue = createQueue(QUEUE_NAMES.SOCIAL_PUBLISHING);
