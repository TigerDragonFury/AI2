import { Worker, type Job } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { QUEUE_NAMES, CLOUDINARY_FOLDERS } from '@adavatar/utils';
import { AI_MODELS, AD_GENERATION } from '@adavatar/config';

import { sendAdReadyEmail } from '../lib/email';
import { dashscopeSubmitVideoTask, dashscopePollVideoTask } from '../lib/dashscope';
import { detectProvider, getProviderKey } from '../lib/settings';
import { DASHSCOPE_NEGATIVE_PROMPT } from '@adavatar/utils';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function pollHuggingFaceJob(jobUrl: string, hfToken: string): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt < AD_GENERATION.MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(jobUrl, {
      headers: { Authorization: `Bearer ${hfToken}` },
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('video')) {
        return response.arrayBuffer();
      }
      const data = (await response.json()) as { status?: string };
      if (data.status === 'error') throw new Error('HuggingFace job failed');
    }

    await new Promise((res) => setTimeout(res, AD_GENERATION.POLL_INTERVAL_MS));
  }
  throw new Error('HuggingFace job timed out');
}

/**
 * Process an ad generation job. The queue payload only contains { adId };
 * all other required data is loaded from the database.
 */
async function processAdJob(job: Job<{ adId: string }>) {
  const { adId } = job.data;

  console.log(`[adWorker] Generating ad ${adId}`);

  await prisma.ad.update({ where: { id: adId }, data: { status: 'processing' } });

  // Load all required fields from DB — the job payload only carries adId
  const ad = await prisma.ad.findUnique({
    where: { id: adId },
    include: {
      product: { select: { imageUrls: true, name: true } },
      avatar: { select: { avatarVideoUrl: true, rawUrl: true, inputType: true } },
    },
  });
  if (!ad) throw new Error(`Ad ${adId} not found in database`);

  const userId = ad.userId;
  const productImageUrls: string[] = ad.product?.imageUrls ?? [];
  const avatarVideoUrl: string = ad.avatar?.avatarVideoUrl ?? '';
  const enhancedPrompt: string = ad.enhancedPrompt ?? ad.rawPrompt;
  const adDuration: number = ad.duration ?? 5;

  // AspectRatio Prisma enum values → pixel dimensions
  const aspectRatioMap: Record<string, { width: number; height: number }> = {
    RATIO_9_16: { width: 720, height: 1280 },
    RATIO_16_9: { width: 1280, height: 720 },
    RATIO_1_1: { width: 720, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '16:9': { width: 1280, height: 720 },
    '1:1': { width: 720, height: 720 },
  };
  const dimensions = aspectRatioMap[ad.aspectRatio as string] ?? { width: 720, height: 1280 };

  // Build the base image for I2V (Wan2.6 "Starring Roles" approach):
  // Use the avatar's raw photo as the character reference — the model preserves the person's
  // likeness throughout the video. The product is described in the prompt.
  // Fall back to product image when no avatar photo exists.
  const avatarRawUrl = ad.avatar?.rawUrl ?? '';
  const avatarInputType = ad.avatar?.inputType ?? 'video';
  const baseImageUrl =
    avatarInputType === 'image' && avatarRawUrl ? avatarRawUrl : (productImageUrls[0] ?? '');
  console.log(
    `[adWorker] Base image mode: ${avatarInputType === 'image' ? 'avatar-as-character-reference' : 'product-only'}`
  );

  try {
    await job.updateProgress(10);

    const provider = await detectProvider();
    console.log(`[adWorker] Using AI provider: ${provider}`);

    let generatedVideoUrl: string;

    if (provider === 'fal') {
      // ── fal.ai (Wan I2V) ───────────────────────────────────────────────────
      const falKey = await getProviderKey('fal');
      if (!falKey) throw new Error('FAL_KEY not configured');

      const falHeaders = {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      };
      const falModel = AI_MODELS.FAL_AD_GENERATION_I2V;

      await job.updateProgress(15);

      const submitRes = await fetch(`https://queue.fal.run/${falModel}`, {
        method: 'POST',
        headers: falHeaders,
        body: JSON.stringify({
          image_url: baseImageUrl,
          prompt: enhancedPrompt,
          num_seconds: adDuration,
          ...dimensions,
        }),
      });
      if (!submitRes.ok) {
        const txt = await submitRes.text();
        throw new Error(`fal.ai submit error ${submitRes.status}: ${txt}`);
      }
      const { request_id } = (await submitRes.json()) as { request_id: string };

      await job.updateProgress(20);

      // Poll for completion (up to 10 min — video gen is slow)
      const MAX_POLLS = 120;
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
        await job.updateProgress(20 + Math.floor((i / MAX_POLLS) * 55));
      }
      if (!completed) throw new Error('fal.ai job timed out after 10 minutes');

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

      await job.updateProgress(80);

      // Upload to Cloudinary from URL
      const uploadResult = await cloudinary.uploader.upload(falVideoUrl, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
        public_id: adId,
      });
      generatedVideoUrl = uploadResult.secure_url;
    } else if (provider === 'dashscope') {
      // ── Alibaba Cloud DashScope (Wan I2V) — 90 days free for new users ────
      const aliKey = await getProviderKey('dashscope');
      if (!aliKey) throw new Error('ALIBABA_API_KEY not configured');

      await job.updateProgress(15);

      // Wan2.6-I2V uses a resolution string; aspect ratio is inferred from the submitted image
      const taskId = await dashscopeSubmitVideoTask(
        AI_MODELS.DASHSCOPE_AD_GENERATION_I2V,
        {
          img_url: baseImageUrl,
          prompt: enhancedPrompt,
          negative_prompt: DASHSCOPE_NEGATIVE_PROMPT,
        },
        { resolution: '720P', duration: adDuration, prompt_extend: true },
        aliKey
      );

      console.log(
        `[adWorker] DashScope: img=${avatarInputType === 'image' ? 'avatar-photo' : 'product-only'}, duration=${adDuration}s`
      );
      console.log(`[adWorker] DashScope task submitted: ${taskId}`);

      const dashVideoUrl = await dashscopePollVideoTask(
        taskId,
        aliKey,
        (pct) => job.updateProgress(15 + Math.floor(pct * 0.65)),
        600_000 // 10 min
      );

      await job.updateProgress(80);

      const uploadResult = await cloudinary.uploader.upload(dashVideoUrl, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
        public_id: adId,
      });
      generatedVideoUrl = uploadResult.secure_url;
    } else {
      // ── HuggingFace ────────────────────────────────────────────────────────
      const hfToken = await getProviderKey('huggingface');
      if (!hfToken) throw new Error('HUGGINGFACE_API_TOKEN not configured');

      const payload = {
        inputs: {
          video: avatarVideoUrl,
          image: baseImageUrl,
          prompt: enhancedPrompt,
          ...dimensions,
          num_frames: Math.round(adDuration * 16), // ~16fps: 5s=80, 10s=160
        },
      };

      const submitResponse = await fetch(
        `https://router.huggingface.co/models/${AI_MODELS.HF_AD_GENERATION_I2V}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
            'X-Use-Cache': 'false',
          },
          body: JSON.stringify(payload),
        }
      );

      await job.updateProgress(20);

      let videoBuffer: ArrayBuffer;
      if (submitResponse.headers.get('content-type')?.includes('video')) {
        videoBuffer = await submitResponse.arrayBuffer();
      } else {
        const jobData = (await submitResponse.json()) as { job_url?: string; url?: string };
        const pollUrl = jobData.job_url ?? jobData.url;
        if (!pollUrl) throw new Error('No job URL returned from HuggingFace');
        await job.updateProgress(30);
        videoBuffer = await pollHuggingFaceJob(pollUrl, hfToken);
      }

      await job.updateProgress(80);

      const base64Video = Buffer.from(videoBuffer).toString('base64');
      const dataUri = `data:video/mp4;base64,${base64Video}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
        public_id: adId,
      });
      generatedVideoUrl = uploadResult.secure_url;
    }

    await job.updateProgress(95);

    await prisma.ad.update({
      where: { id: adId },
      data: { generatedVideoUrl: generatedVideoUrl, status: 'ready' },
    });

    await prisma.notification.create({
      data: {
        userId,
        event: 'ad_generation_complete',
        message: 'Your ad video is ready.',
        metadata: { adId },
      },
    });

    // Send email notification
    const adUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (adUser?.email) {
      sendAdReadyEmail(adUser.email, adUser.name ?? '', adId).catch(console.error);
    }

    await job.updateProgress(100);
    console.log(`[adWorker] Ad ${adId} generated successfully`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[adWorker] Failed to generate ad ${adId}: ${message}`);

    await prisma.ad.update({
      where: { id: adId },
      data: { status: 'failed', errorMessage: message },
    });

    await prisma.notification.create({
      data: {
        userId,
        event: 'ad_generation_failed',
        message: `Ad generation failed: ${message}`,
        metadata: { adId },
      },
    });

    throw err;
  }
}

export const adGenerationWorker = new Worker<{ adId: string }>(
  QUEUE_NAMES.AD_GENERATION,
  processAdJob,
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

adGenerationWorker.on('failed', (job, err) => {
  console.error(`[adWorker] Job ${job?.id} failed:`, err.message);
});
