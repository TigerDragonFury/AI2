import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { QUEUE_NAMES, CLOUDINARY_FOLDERS } from '@adavatar/utils';
import { AI_MODELS, UPLOAD_LIMITS } from '@adavatar/config';
import '../queues/avatarProcessingQueue'; // ensure queue is registered
import type { AvatarProcessingJobPayload } from '@adavatar/types';
import { dashscopeSubmitVideoTask, dashscopePollVideoTask } from '../lib/dashscope';
import { detectProvider, getProviderKey } from '../lib/settings';

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

    // ── AI Processing ────────────────────────────────────────────────────────
    const provider = await detectProvider();
    console.log(`[avatarWorker] Using AI provider: ${provider}`);

    let processedVideoUrl: string;

    if (provider === 'fal') {
      // ── fal.ai (LivePortrait) ──────────────────────────────────────────────
      const falKey = await getProviderKey('fal');
      if (!falKey) throw new Error('FAL_KEY not configured');

      const falHeaders = {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      };
      const falModel = AI_MODELS.FAL_AVATAR_ANIMATION;

      await job.updateProgress(30);

      // Submit to fal.ai queue
      const submitRes = await fetch(`https://queue.fal.run/${falModel}`, {
        method: 'POST',
        headers: falHeaders,
        body: JSON.stringify({ image_url: rawUrl }),
      });
      if (!submitRes.ok) {
        const txt = await submitRes.text();
        throw new Error(`fal.ai submit error ${submitRes.status}: ${txt}`);
      }
      const { request_id } = (await submitRes.json()) as { request_id: string };

      await job.updateProgress(35);

      // Poll for completion (up to 5 min)
      const MAX_POLLS = 60;
      const POLL_INTERVAL_MS = 5000;
      let completed = false;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const statusRes = await fetch(
          `https://queue.fal.run/${falModel}/requests/${request_id}/status`,
          { headers: falHeaders }
        );
        const statusData = (await statusRes.json()) as { status: string; error?: string };
        if (statusData.status === 'COMPLETED') {
          completed = true;
          break;
        }
        if (statusData.status === 'FAILED') {
          throw new Error(`fal.ai job failed: ${statusData.error ?? 'unknown'}`);
        }
        await job.updateProgress(35 + Math.floor((i / MAX_POLLS) * 35));
      }
      if (!completed) throw new Error('fal.ai job timed out after 5 minutes');

      // Fetch result
      const resultRes = await fetch(`https://queue.fal.run/${falModel}/requests/${request_id}`, {
        headers: falHeaders,
      });
      if (!resultRes.ok) throw new Error(`fal.ai result fetch error ${resultRes.status}`);
      const resultData = (await resultRes.json()) as {
        video?: { url: string };
        output?: { video?: { url: string }; video_url?: string };
      };
      const falVideoUrl =
        resultData.video?.url ?? resultData.output?.video?.url ?? resultData.output?.video_url;
      if (!falVideoUrl)
        throw new Error(`fal.ai returned no video URL: ${JSON.stringify(resultData)}`);

      await job.updateProgress(70);

      // Upload to Cloudinary from URL (no buffer needed)
      const uploadResult = await cloudinary.uploader.upload(falVideoUrl, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.PROCESSED_AVATARS,
        public_id: avatarId,
      });
      processedVideoUrl = uploadResult.secure_url;
    } else if (provider === 'dashscope') {
      // ── Alibaba Cloud DashScope (Wan I2V) — 90 days free for new users ────
      const aliKey = await getProviderKey('dashscope');
      if (!aliKey) throw new Error('ALIBABA_API_KEY not configured');

      await job.updateProgress(30);

      const taskId = await dashscopeSubmitVideoTask(
        AI_MODELS.DASHSCOPE_AVATAR_ANIMATION,
        { img_url: rawUrl, prompt: 'Animate this portrait naturally' },
        { size: '720*1280', duration: 5 },
        aliKey
      );

      console.log(`[avatarWorker] DashScope task submitted: ${taskId}`);

      const dashVideoUrl = await dashscopePollVideoTask(
        taskId,
        aliKey,
        (pct) => job.updateProgress(30 + Math.floor(pct * 0.4)),
        300_000 // 5 min
      );

      await job.updateProgress(70);

      const uploadResult = await cloudinary.uploader.upload(dashVideoUrl, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.PROCESSED_AVATARS,
        public_id: avatarId,
      });
      processedVideoUrl = uploadResult.secure_url;
    } else {
      // ── HuggingFace (router.huggingface.co) ───────────────────────────────
      const hfToken = await getProviderKey('huggingface');
      if (!hfToken) throw new Error('HUGGINGFACE_API_TOKEN not configured');

      await job.updateProgress(30);

      const hfResponse = await fetch(
        `https://router.huggingface.co/models/${AI_MODELS.HF_AVATAR_ANIMATION}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: rawUrl,
            parameters: { output_format: 'mp4', duration: 5, loop: true },
          }),
        }
      );

      if (hfResponse.status === 503) {
        const body = (await hfResponse.json().catch(() => ({}))) as { estimated_time?: number };
        throw new Error(
          `HuggingFace model loading, estimated ${body.estimated_time ?? 20}s — will retry`
        );
      }
      if (!hfResponse.ok) {
        const errorText = await hfResponse.text();
        throw new Error(`HuggingFace API error ${hfResponse.status}: ${errorText}`);
      }

      await job.updateProgress(70);

      const videoBuffer = await hfResponse.arrayBuffer();
      const base64Video = Buffer.from(videoBuffer).toString('base64');
      const dataUri = `data:video/mp4;base64,${base64Video}`;

      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.PROCESSED_AVATARS,
        public_id: avatarId,
      });
      processedVideoUrl = uploadResult.secure_url;
    }

    await job.updateProgress(90);

    await prisma.avatar.update({
      where: { id: avatarId },
      data: {
        avatarVideoUrl: processedVideoUrl,
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
    // Cloudinary SDK throws plain objects: { error: { message } }
    // Handle all throw shapes to avoid "Unknown error" masking real cause
    let message: string;
    if (err instanceof Error) {
      message = err.message;
    } else if (
      typeof err === 'object' &&
      err !== null &&
      'error' in err &&
      typeof (err as { error: unknown }).error === 'object' &&
      (err as { error: { message?: unknown } }).error !== null &&
      typeof (err as { error: { message: unknown } }).error.message === 'string'
    ) {
      message = (err as { error: { message: string } }).error.message;
    } else {
      try {
        message = JSON.stringify(err);
      } catch {
        message = String(err);
      }
    }
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
