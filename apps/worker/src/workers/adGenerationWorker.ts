import { Worker, type Job } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { QUEUE_NAMES, CLOUDINARY_FOLDERS } from '@adavatar/utils';
import { AI_MODELS, AD_GENERATION } from '@adavatar/config';
import type { AdGenerationJobPayload } from '@adavatar/types';
import { sendAdReadyEmail } from '../lib/email';

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

async function processAdJob(job: Job<AdGenerationJobPayload>) {
  const { adId, userId, avatarVideoUrl, productImageUrls, enhancedPrompt, aspectRatio } = job.data;

  console.log(`[adWorker] Generating ad ${adId}`);

  await prisma.ad.update({ where: { id: adId }, data: { status: 'processing' } });

  try {
    await job.updateProgress(10);

    const hfToken = process.env.HUGGINGFACE_API_TOKEN;
    if (!hfToken) throw new Error('HUGGINGFACE_API_TOKEN not configured');

    const aspectRatioMap: Record<string, { width: number; height: number }> = {
      '9:16': { width: 720, height: 1280 },
      '16:9': { width: 1280, height: 720 },
      '1:1': { width: 720, height: 720 },
    };
    const dimensions = aspectRatioMap[aspectRatio] ?? { width: 720, height: 1280 };

    const payload = {
      inputs: {
        video: avatarVideoUrl,
        image: productImageUrls[0],
        prompt: enhancedPrompt,
        ...dimensions,
        num_frames: 81,
      },
    };

    // Submit job to HuggingFace
    const submitResponse = await fetch(
      `https://api-inference.huggingface.co/models/${AI_MODELS.AD_GENERATION_I2V}`,
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
      // Async job — poll for result
      const jobData = (await submitResponse.json()) as { job_url?: string; url?: string };
      const pollUrl = jobData.job_url ?? jobData.url;
      if (!pollUrl) throw new Error('No job URL returned from HuggingFace');

      await job.updateProgress(30);
      videoBuffer = await pollHuggingFaceJob(pollUrl, hfToken);
    }

    await job.updateProgress(80);

    // Upload to Cloudinary
    const base64Video = Buffer.from(videoBuffer).toString('base64');
    const dataUri = `data:video/mp4;base64,${base64Video}`;

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      resource_type: 'video',
      folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
      public_id: adId,
    });

    await job.updateProgress(95);

    await prisma.ad.update({
      where: { id: adId },
      data: { generatedVideoUrl: uploadResult.secure_url, status: 'ready' },
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

export const adGenerationWorker = new Worker<AdGenerationJobPayload>(
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
