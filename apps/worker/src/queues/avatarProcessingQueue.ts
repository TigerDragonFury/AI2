import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { QUEUE_NAMES, type QueueName } from '@adavatar/utils';
import { JOB_OPTIONS } from '@adavatar/config';

function createQueue(name: QueueName) {
  return new Queue(name, {
    connection: redisConnection,
    defaultJobOptions: JOB_OPTIONS,
  });
}

export const avatarProcessingQueue = createQueue(QUEUE_NAMES.AVATAR_PROCESSING);
export const adGenerationQueue = createQueue(QUEUE_NAMES.AD_GENERATION);
export const socialPublishingQueue = createQueue(QUEUE_NAMES.SOCIAL_PUBLISHING);
