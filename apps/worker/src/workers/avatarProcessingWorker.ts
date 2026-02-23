import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { QUEUE_NAMES, CLOUDINARY_FOLDERS } from '@adavatar/utils';
import { AI_MODELS, UPLOAD_LIMITS } from '@adavatar/config';
import '../queues/avatarProcessingQueue'; // ensure queue is registered
import type { AvatarProcessingJobPayload } from '@adavatar/types';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Extract the Cloudinary public_id from a secure_url.
 * e.g. https://res.cloudinary.com/cloud/image/upload/v1234/raw_uploads/abc.jpg
 *   → raw_uploads/abc
 */
function extractPublicId(url: string): string {
  const clean = url.split('?')[0];
  const match = clean.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^./]+)?$/);
  return match ? match[1] : url;
}

async function processAvatarJob(job: Job<AvatarProcessingJobPayload>) {
  const { avatarId, userId, rawUrl, inputType } = job.data;

  console.log(`[avatarWorker] Processing avatar ${avatarId} (${inputType})`);

  await prisma.avatar.update({
    where: { id: avatarId },
    data: { status: 'processing' },
  });

  try {
    // ── Validation ──────────────────────────────────────────────────────────
    await job.updateProgress(10);

    if (inputType === 'image') {
      const info = await cloudinary.api.resource(extractPublicId(rawUrl), {
        resource_type: 'image',
      });
      if (
        info.width < UPLOAD_LIMITS.AVATAR_MIN_IMAGE_DIMENSION ||
        info.height < UPLOAD_LIMITS.AVATAR_MIN_IMAGE_DIMENSION
      ) {
        throw new Error(
          `Image too small. Minimum ${UPLOAD_LIMITS.AVATAR_MIN_IMAGE_DIMENSION}×${UPLOAD_LIMITS.AVATAR_MIN_IMAGE_DIMENSION}px required.`
        );
      }
    } else {
      const info = await cloudinary.api.resource(extractPublicId(rawUrl), {
        resource_type: 'video',
      });
      if (
        info.duration < UPLOAD_LIMITS.AVATAR_MIN_VIDEO_DURATION_SEC ||
        info.duration > UPLOAD_LIMITS.AVATAR_MAX_VIDEO_DURATION_SEC
      ) {
        throw new Error(
          `Video duration must be between ${UPLOAD_LIMITS.AVATAR_MIN_VIDEO_DURATION_SEC}–${UPLOAD_LIMITS.AVATAR_MAX_VIDEO_DURATION_SEC}s.`
        );
      }
      if (info.height < UPLOAD_LIMITS.AVATAR_MIN_VIDEO_RESOLUTION) {
        throw new Error(
          `Video resolution must be at least ${UPLOAD_LIMITS.AVATAR_MIN_VIDEO_RESOLUTION}p.`
        );
      }
    }

    await job.updateProgress(25);

    // ── AI Processing via HuggingFace ───────────────────────────────────────
    const hfToken = process.env.HUGGINGFACE_API_TOKEN;
    if (!hfToken) throw new Error('HUGGINGFACE_API_TOKEN not configured');

    // Build payload for LivePortrait
    const payload = {
      inputs: rawUrl,
      parameters: {
        output_format: 'mp4',
        duration: 5,
        loop: true,
      },
    };

    await job.updateProgress(30);

    // Call HuggingFace inference API
    const hfResponse = await fetch(
      `https://api-inference.huggingface.co/models/${AI_MODELS.AVATAR_ANIMATION}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (hfResponse.status === 503) {
      // Model is loading — BullMQ will retry via exponential backoff
      const body = (await hfResponse.json().catch(() => ({}))) as { estimated_time?: number };
      const wait = body.estimated_time ?? 20;
      throw new Error(`HuggingFace model loading, estimated ${wait}s — will retry`);
    }

    if (!hfResponse.ok) {
      const errorText = await hfResponse.text();
      throw new Error(`HuggingFace API error ${hfResponse.status}: ${errorText}`);
    }

    await job.updateProgress(70);

    // Upload result to Cloudinary
    const videoBuffer = await hfResponse.arrayBuffer();
    const base64Video = Buffer.from(videoBuffer).toString('base64');
    const dataUri = `data:video/mp4;base64,${base64Video}`;

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      resource_type: 'video',
      folder: CLOUDINARY_FOLDERS.PROCESSED_AVATARS,
      public_id: avatarId,
    });

    await job.updateProgress(90);

    await prisma.avatar.update({
      where: { id: avatarId },
      data: {
        avatarVideoUrl: uploadResult.secure_url,
        status: 'ready',
      },
    });

    // Create notification
    await prisma.notification.create({
      data: {
        userId,
        event: 'avatar_processing_complete',
        message: 'Your avatar is ready to use.',
        metadata: { avatarId },
      },
    });

    await job.updateProgress(100);
    console.log(`[avatarWorker] Avatar ${avatarId} processed successfully`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[avatarWorker] Failed to process avatar ${avatarId}: ${message}`);

    await prisma.avatar.update({
      where: { id: avatarId },
      data: { status: 'failed', errorMessage: message },
    });

    await prisma.notification.create({
      data: {
        userId,
        event: 'avatar_processing_failed',
        message: `Avatar processing failed: ${message}`,
        metadata: { avatarId },
      },
    });

    throw err;
  }
}

export const avatarProcessingWorker = new Worker<AvatarProcessingJobPayload>(
  QUEUE_NAMES.AVATAR_PROCESSING,
  processAvatarJob,
  {
    connection: redisConnection as unknown as ConnectionOptions,
    concurrency: 3,
  }
);

avatarProcessingWorker.on('failed', (job, err) => {
  console.error(`[avatarWorker] Job ${job?.id} failed:`, err.message);
});
