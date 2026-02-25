import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { QUEUE_NAMES } from '@adavatar/utils';
import type { SocialPublishingJobPayload } from '@adavatar/types';
import { sendPublishSummaryEmail } from '../lib/email';
import { publishToTikTok } from './platforms/tiktok';
import { publishToYouTube } from './platforms/youtube';
import { publishToInstagram } from './platforms/instagram';
import { publishToFacebook } from './platforms/facebook';
import { publishToSnapchat } from './platforms/snapchat';

async function processSocialJob(job: Job<SocialPublishingJobPayload>) {
  const { publishJobId, userId, platform, generatedVideoUrl, caption, hashtags } = job.data;

  console.log(`[publishWorker] Publishing job ${publishJobId} to ${platform}`);

  await prisma.publishJob.update({
    where: { id: publishJobId },
    data: { status: 'processing' },
  });

  try {
    // Fetch platform token
    const token = await prisma.platformToken.findFirst({
      where: { userId, platform, isExpired: false },
    });

    if (!token) {
      throw new Error(`No valid token for platform: ${platform}`);
    }

    await job.updateProgress(10);

    let postId: string;

    switch (platform) {
      case 'tiktok':
        postId = await publishToTikTok({ token, generatedVideoUrl, caption, hashtags });
        break;
      case 'youtube':
        postId = await publishToYouTube({ token, generatedVideoUrl, caption, hashtags });
        break;
      case 'instagram':
        postId = await publishToInstagram({ token, generatedVideoUrl, caption, hashtags });
        break;
      case 'facebook':
        postId = await publishToFacebook({ token, generatedVideoUrl, caption, hashtags });
        break;
      case 'snapchat':
        postId = await publishToSnapchat({ token, generatedVideoUrl, caption, hashtags });
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    await job.updateProgress(100);

    await prisma.publishJob.update({
      where: { id: publishJobId },
      data: {
        status: 'published',
        postId,
        publishedAt: new Date(),
      },
    });

    await prisma.notification.create({
      data: {
        userId,
        event: 'publish_succeeded',
        message: `Your ad was successfully published to ${platform}.`,
        metadata: { publishJobId, platform, postId },
      },
    });

    // Send email notification
    const pubUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (pubUser?.email) {
      sendPublishSummaryEmail(pubUser.email, pubUser.name ?? '', [platform]).catch(console.error);
    }

    console.log(`[publishWorker] Published job ${publishJobId} to ${platform} (postId: ${postId})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[publishWorker] Failed to publish ${publishJobId} to ${platform}: ${message}`);

    // Check if token-related error
    const isTokenError =
      message.toLowerCase().includes('token') || message.toLowerCase().includes('auth');

    if (isTokenError) {
      await prisma.platformToken.updateMany({
        where: { userId, platform },
        data: { isExpired: true },
      });
    }

    await prisma.publishJob.update({
      where: { id: publishJobId },
      data: { status: 'failed', errorMessage: message },
    });

    await prisma.notification.create({
      data: {
        userId,
        event: 'publish_failed',
        message: `Failed to publish to ${platform}: ${message}`,
        metadata: { publishJobId, platform },
      },
    });

    throw err;
  }
}

export const socialPublishingWorker = new Worker<SocialPublishingJobPayload>(
  QUEUE_NAMES.SOCIAL_PUBLISHING,
  processSocialJob,
  {
    connection: redisConnection,
    concurrency: 5,
    drainDelay: 5_000,
    stalledInterval: 300_000,
    lockDuration: 300_000,
    skipVersionCheck: true,
  }
);

socialPublishingWorker.on('failed', (job, err) => {
  console.error(`[publishWorker] Job ${job?.id} failed:`, err.message);
});
