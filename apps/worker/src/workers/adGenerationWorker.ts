import { Worker, type Job } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { QUEUE_NAMES, CLOUDINARY_FOLDERS, enhanceAdPrompt } from '@adavatar/utils';
import { AI_MODELS, AD_GENERATION, TTS_VOICE_BY_LANGUAGE } from '@adavatar/config';

import { sendAdReadyEmail } from '../lib/email';
import {
  dashscopeSubmitVideoTask,
  dashscopePollVideoTask,
  dashscopeSubmitImageEditTask,
  dashscopePollImageTask,
  dashscopeTextToSpeech,
  dashscopeGenerateDialogue,
  dashscopeAnalyzeProductImage,
  type DialogueContext,
} from '../lib/dashscope';
import {
  veoGenerateVideo,
  geminiTextToSpeech,
  geminiCinematicPrompt,
  uploadToGoogleDrive,
} from '../lib/google';
import {
  klingVeoSubmitTask,
  klingVeoPollTask,
  submitKlingVeoLegacy,
  submitKlingVeoExtend,
  concatVideos,
  klingVeoPoll,
  LEGACY_VEO_MODELS,
  kieGenerateDialogue,
  kieAnalyzeProductImage,
  kieCinematicPrompt,
  buildVeoSegmentPrompts,
  fishAudioTTS,
  overlayAudio,
} from '../lib/kling';
import {
  detectProvider,
  getProviderKey,
  getModelConfig,
  getStorageConfig,
  getAppSetting,
} from '../lib/settings';
import { DASHSCOPE_NEGATIVE_PROMPT } from '@adavatar/utils';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * If the avatar has a Fish Audio voice ID and there is dialogue text, generate
 * TTS audio and replace the video's audio track with it.  Non-fatal — if Fish
 * Audio fails the original buffer is returned unchanged.
 */
async function maybeApplyFishAudioVoice(
  buf: Buffer,
  voiceId: string | null | undefined,
  text: string
): Promise<Buffer> {
  if (!voiceId || !text) return buf;
  const fishKey = process.env.FISH_AUDIO_API_KEY;
  if (!fishKey) {
    console.warn('[adWorker] FISH_AUDIO_API_KEY not set — skipping Fish Audio voice overlay');
    return buf;
  }
  try {
    console.log(`[adWorker] Fish Audio TTS overlay (voiceId=${voiceId}, chars=${text.length})…`);
    const audioBuf = await fishAudioTTS(text, voiceId, fishKey);
    const out = await overlayAudio(buf, audioBuf);
    console.log('[adWorker] Fish Audio voice overlay complete');
    return out;
  } catch (e) {
    console.warn(
      '[adWorker] Fish Audio overlay failed (keeping original audio):',
      (e as Error).message
    );
    return buf;
  }
}

/**
 * For Cloudinary-hosted images, chain two URL transformations so that
 *   (a) any dimension below `min` is scaled UP proportionally, then
 *   (b) any dimension above `max` is scaled DOWN.
 *
 * DashScope wan2.5-i2i-preview and wan2.6-i2v both require each side to be
 * in the range [384, 5000].  Pass min=384, max=4000 for all DashScope calls.
 * Non-Cloudinary URLs are returned unchanged.
 */
function fitCloudinaryDimensions(url: string, min: number, max: number): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  // Cloudinary conditional transforms: scale up if either side is below `min`,
  // then cap both sides to `max`.  Steps are separated by '/'.
  const transforms = [
    `if_h_lt_${min}`, // --- if height < min
    `c_scale,h_${min}`, //     scale so height == min (width follows AR)
    'if_end', // --- end if
    `if_w_lt_${min}`, // --- if width < min (re-check after h-scale)
    `c_scale,w_${min}`, //     scale so width == min
    'if_end', // --- end if
    `c_limit,w_${max},h_${max}`, // cap the maximum
  ].join('/');
  return url.replace('/upload/', `/upload/${transforms}/`);
}

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
 * Run Veo extend loop with crash recovery.
 * Submits extend tasks until `state.partUrls.length - 1 === state.numExtensions`,
 * then downloads all parts and returns a concatenated Buffer.
 *
 * Redis keys used:
 *   kie:extendState:{adId} — full loop state (survives redeploys)
 *   kie:extendTask:{adId}  — taskId currently being polled
 */
async function runVeoExtendLoop(
  adId: string,
  state: { numExtensions: number; partUrls: string[]; prevTaskId: string },
  model: 'fast' | 'quality',
  /** Single fallback prompt OR per-segment array (index 0 = 1st extension, etc.) */
  continuationPrompts: string | string[],
  klingKey: string,
  onProgress: (pct: number) => void
): Promise<Buffer> {
  const kieExtendStateKey = `kie:extendState:${adId}`;
  const kieActiveExtendKey = `kie:extendTask:${adId}`;
  await redisConnection.set(kieExtendStateKey, JSON.stringify(state), 'EX', 14400);

  while (state.partUrls.length - 1 < state.numExtensions) {
    const extIndex = state.partUrls.length - 1; // 0-based index of THIS extension
    const prompt = Array.isArray(continuationPrompts)
      ? (continuationPrompts[extIndex] ?? continuationPrompts[continuationPrompts.length - 1])
      : continuationPrompts;

    let activeId = await redisConnection.get(kieActiveExtendKey);
    if (!activeId) {
      activeId = await submitKlingVeoExtend(state.prevTaskId, prompt, model, klingKey);
      await redisConnection.set(kieActiveExtendKey, activeId, 'EX', 14400);
    }
    const extUrl = await klingVeoPoll(activeId, klingKey, onProgress);
    state.prevTaskId = activeId;
    state.partUrls.push(extUrl);
    await redisConnection.del(kieActiveExtendKey);
    await redisConnection.set(kieExtendStateKey, JSON.stringify(state), 'EX', 14400);
    console.log(
      `[adWorker] Veo extend ${state.partUrls.length - 1}/${state.numExtensions} done: ${extUrl}`
    );
  }

  // Download all parts, trim 0.5 s off each extension to remove boundary duplicates
  console.log(`[adWorker] Downloading ${state.partUrls.length} Veo parts for concat...`);
  const partBufs = await Promise.all(
    state.partUrls.map((url, i) =>
      fetch(url, { signal: AbortSignal.timeout(30_000) })
        .then((r) => {
          if (!r.ok) throw new Error(`Part ${i} download error ${r.status}: ${url}`);
          return r.arrayBuffer();
        })
        .then((a) => {
          const buf = Buffer.from(a);
          console.log(`[adWorker] Part ${i} downloaded: ${(buf.length / 1_048_576).toFixed(1)} MB`);
          return buf;
        })
    )
  );
  console.log(`[adWorker] Concatenating ${partBufs.length} parts with ffmpeg...`);
  // trimExtStartSec=0.7: removes the overlapping ~0.7 s Veo adds at each extension boundary.
  // The first and last segments are never trimmed — only middle boundaries.
  const merged = await concatVideos(partBufs, 0.7);
  console.log(`[adWorker] Concat done: ${(merged.length / 1_048_576).toFixed(1)} MB`);
  await redisConnection.del(kieExtendStateKey);
  return merged;
}

/**
 * Process an ad generation job. The queue payload only contains { adId };
 * all other required data is loaded from the database.
 */
async function processAdJob(job: Job<{ adId: string }>) {
  const { adId } = job.data;

  console.log(`[adWorker] Generating ad ${adId}`);

  // Load all required fields from DB — the job payload only carries adId
  const ad = await prisma.ad.findUnique({
    where: { id: adId },
    include: {
      product: {
        select: { imageUrls: true, name: true, price: true, currency: true, description: true },
      },
      avatar: {
        select: { avatarVideoUrl: true, rawUrl: true, inputType: true, name: true, voiceId: true },
      },
      user: {
        select: {
          companyName: true,
          brandVoicePreset: true,
          brandVoiceCustom: true,
          companyLogoUrl: true,
        },
      },
    },
  });

  // If the ad was deleted while queued, discard the job silently (no retry)
  if (!ad) {
    console.warn(`[adWorker] Ad ${adId} not found — was likely deleted. Skipping job.`);
    return;
  }

  // ── Per-ad mutex ─────────────────────────────────────────────────────────
  // Only one job may process a given adId at a time.  This prevents duplicate
  // concurrent runs when BullMQ stall-recovery AND a manual admin Resume
  // both activate jobs for the same adId simultaneously.
  // TTL = 25 min (safety net if the process crashes before release).
  const adMutexKey = `adMutex:${adId}`;
  const gotLock = await redisConnection.set(adMutexKey, job.id ?? 'unknown', 'EX', 1500, 'NX');
  if (!gotLock) {
    const holder = await redisConnection.get(adMutexKey);
    // Allow through if THIS job is the one that holds the lock — this happens
    // when BullMQ stall-recovery retries the same job after a process crash
    // (the lock was never released because the process was killed).
    if (holder && holder === job.id) {
      // Re-arm the TTL so it doesn't expire mid-run
      await redisConnection.expire(adMutexKey, 1500);
      console.log(`[adWorker] Re-acquired stale mutex for own job ${job.id} (ad ${adId})`);
    } else {
      console.log(
        `[adWorker] Skipping duplicate job — ad ${adId} already being processed by job ${holder}`
      );
      return;
    }
  }

  await prisma.ad.update({ where: { id: adId }, data: { status: 'processing' } });

  // Load model IDs from DB (admin-configurable) with code-default fallbacks.
  // Cached 60 s — no restart needed when changed via admin UI.
  const models = await getModelConfig();

  // Build brand/dialogue context once — used by both VL auto-prompt and dialogue generation.
  const brandVoiceParts = [ad.user?.brandVoicePreset, ad.user?.brandVoiceCustom].filter(Boolean);
  const dialogueCtx: DialogueContext = {
    companyName: ad.user?.companyName ?? undefined,
    brandVoice: brandVoiceParts.length ? brandVoiceParts.join(', ') : undefined,
    price:
      ad.product?.price != null ? `${ad.product.price} ${ad.product.currency ?? 'USD'}` : undefined,
    productDescription: ad.product?.description ?? undefined,
  };
  console.log(
    `[adWorker] Brand context — company:${
      dialogueCtx.companyName ?? 'none'
    }, voice:${dialogueCtx.brandVoice ?? 'none'}, price:${dialogueCtx.price ?? 'none'}`
  );

  const userId = ad.userId;
  const productImageUrls: string[] = ad.product?.imageUrls ?? [];
  const avatarVideoUrl: string = ad.avatar?.avatarVideoUrl ?? '';
  const adDuration: number = ad.duration ?? 8;

  // AspectRatio Prisma enum → ratio string for enhanceAdPrompt
  const aspectRatioReverseMap: Record<string, '9:16' | '16:9' | '1:1'> = {
    RATIO_9_16: '9:16',
    RATIO_16_9: '16:9',
    RATIO_1_1: '1:1',
  };
  const aspectRatioStr = aspectRatioReverseMap[ad.aspectRatio as string] ?? '9:16';

  // Detect provider early — needed for both auto-prompt (vision) and cinematic prompt
  const provider = await detectProvider();

  // ── Kie.ai resume fast-path ───────────────────────────────────────────────
  // If a Redis key exists for this ad it means a Kie.ai task was already
  // submitted (e.g. before a Render redeploy stalled the job). Skip all
  // pre-processing (vision, cinematic, dialogue) and go straight to polling.
  if (provider === 'kling') {
    // ── Extend task fast-path ─────────────────────────────────────────────────
    // If kie:extendState exists the initial generation is done and we are
    // mid-extend. Resume the loop and finalize.
    if (LEGACY_VEO_MODELS.has(models.klingVeoModel)) {
      const kieExtendStateKey = `kie:extendState:${adId}`;
      const existingStateJson = await redisConnection.get(kieExtendStateKey);
      if (existingStateJson) {
        console.log(`[adWorker] Extend fast-path: resuming extend state for ad ${adId}`);
        const klingKey = await getProviderKey('kling');
        if (!klingKey) throw new Error('KLING_API_KEY not configured');
        const fpLangMap: Record<string, string> = {
          en: 'English',
          ar: 'Arabic',
          fr: 'French',
          es: 'Spanish',
          de: 'German',
          ja: 'Japanese',
          ko: 'Korean',
          zh: 'Chinese',
        };
        const fpSpokenLang = fpLangMap[(ad.dialogueLanguage ?? 'en').toLowerCase()] ?? 'English';
        const veoExtendModel = models.klingVeoModel === 'veo3_fast' ? 'fast' : 'quality';
        const extStateForPrompts = JSON.parse(existingStateJson) as {
          numExtensions: number;
          partUrls: string[];
          prevTaskId: string;
        };
        const fpSegmentPrompts = buildVeoSegmentPrompts(
          ad.product?.name ?? 'the product',
          ad.avatar?.name ?? 'the creator',
          fpSpokenLang,
          extStateForPrompts.numExtensions
        );
        try {
          await job.updateProgress(80);
          const extState = extStateForPrompts;
          let mergedBuf = await runVeoExtendLoop(
            adId,
            extState,
            veoExtendModel,
            fpSegmentPrompts,
            klingKey,
            (pct) => job.updateProgress(80 + Math.floor(pct * 0.18))
          );
          mergedBuf = await maybeApplyFishAudioVoice(
            mergedBuf,
            ad.avatar?.voiceId,
            ad.dialogueText ?? ''
          );
          await job.updateProgress(95);
          const extUpload = await cloudinary.uploader.upload(
            `data:video/mp4;base64,${mergedBuf.toString('base64')}`,
            { resource_type: 'video', folder: CLOUDINARY_FOLDERS.GENERATED_ADS, public_id: adId }
          );
          const generatedVideoUrl = extUpload.secure_url;
          await prisma.ad.update({
            where: { id: adId },
            data: { generatedVideoUrl, status: 'ready' },
          });
          await prisma.notification.create({
            data: {
              userId: ad.userId,
              event: 'ad_generation_complete',
              message: 'Your ad video is ready.',
              metadata: { adId },
            },
          });
          const adUser1 = await prisma.user.findUnique({
            where: { id: ad.userId },
            select: { email: true, name: true },
          });
          if (adUser1?.email)
            sendAdReadyEmail(adUser1.email, adUser1.name ?? '', adId).catch(console.error);
          await job.updateProgress(100);
          console.log(
            `[adWorker] Ad ${adId} extend fast-path done (~${extState.partUrls.length * 8} s)`
          );
          await redisConnection.del(adMutexKey);
          return;
        } catch (extFastErr) {
          const extFastErrMsg = (extFastErr as Error).message;
          const isVeoApiTimeout =
            extFastErrMsg.toLowerCase().includes('timed out after') ||
            extFastErrMsg.includes('Kling Veo timed out');
          if (isVeoApiTimeout) {
            // Veo API poll timed out — keep extendState so next retry can re-poll.
            console.warn(`[adWorker] Extend fast-path: Veo API timed out — rethrowing for retry`);
            throw extFastErr;
          }
          // Download failure, ffmpeg error, or AbortSignal timeout on temp URL.
          // The temp URLs are likely expired — clear ALL state so next retry starts fresh.
          console.warn(
            `[adWorker] Extend fast-path failed (${extFastErrMsg}) — clearing Redis state for fresh re-generation`
          );
          await Promise.all([
            redisConnection.del(`kie:extendTask:${adId}`),
            redisConnection.del(`kie:extendState:${adId}`),
            redisConnection.del(`kie:pendingTask:${adId}`),
          ]);
          // Don't rethrow — fall through to full re-generation below
          console.warn(`[adWorker] Extend fast-path cleared — will re-generate from scratch`);
        }
      }
      // Clean up any legacy keys from previous code version
      const legacyExtend = await redisConnection.get(`kie:extendTask:${adId}`);
      if (legacyExtend) {
        await Promise.all([
          redisConnection.del(`kie:extendTask:${adId}`),
          redisConnection.del(`kie:initialUrl:${adId}`),
        ]);
        console.warn(
          `[adWorker] Cleared legacy kie:extendTask (no extendState) — re-run will extend fresh`
        );
      }
    }

    const kieTaskKey = `kie:pendingTask:${adId}`;
    const existingTaskId = await redisConnection.get(kieTaskKey);
    console.log(
      `[adWorker] Fast-path check: ${kieTaskKey} → ${existingTaskId ?? 'null (no fast-path)'}`
    );
    if (existingTaskId) {
      console.log(
        `[adWorker] Fast-path resume: polling existing Kie.ai task ${existingTaskId} (skipping vision/cinematic/dialogue)`
      );
      const klingKey = await getProviderKey('kling');
      if (!klingKey) throw new Error('KLING_API_KEY not configured');

      try {
        await job.updateProgress(20);
        const isLegacyVeo = LEGACY_VEO_MODELS.has(models.klingVeoModel);
        const klingVideoUrl = isLegacyVeo
          ? await klingVeoPoll(existingTaskId, klingKey, (pct) =>
              job.updateProgress(20 + Math.floor(pct * 0.6))
            )
          : await klingVeoPollTask(existingTaskId, klingKey, (pct) =>
              job.updateProgress(20 + Math.floor(pct * 0.6))
            );
        await redisConnection.del(kieTaskKey);
        await job.updateProgress(80);

        // Multi-extend for Legacy Veo: 8s→0 extends, 16s→1, 24s→2, 32s→3
        const fpLangMap2: Record<string, string> = {
          en: 'English',
          ar: 'Arabic',
          fr: 'French',
          es: 'Spanish',
          de: 'German',
          ja: 'Japanese',
          ko: 'Korean',
          zh: 'Chinese',
        };
        const fpSpokenLang2 = fpLangMap2[(ad.dialogueLanguage ?? 'en').toLowerCase()] ?? 'English';
        const numExtFP = Math.min(3, Math.max(0, Math.ceil((ad.duration ?? 8) / 8) - 1));
        let finalBufFP: Buffer | null = null;
        if (isLegacyVeo && numExtFP > 0) {
          const veoExtendModel = models.klingVeoModel === 'veo3_fast' ? 'fast' : 'quality';
          const segmentPromptsFP = buildVeoSegmentPrompts(
            ad.product?.name ?? 'the product',
            ad.avatar?.name ?? 'the creator',
            fpSpokenLang2,
            numExtFP
          );
          const initState = {
            numExtensions: numExtFP,
            partUrls: [klingVideoUrl],
            prevTaskId: existingTaskId,
          };
          try {
            finalBufFP = await runVeoExtendLoop(
              adId,
              initState,
              veoExtendModel,
              segmentPromptsFP,
              klingKey,
              (pct) => job.updateProgress(80 + Math.floor(pct * 0.15))
            );
            console.log(
              `[adWorker] Fast-path extend+concat done (~${(numExtFP + 1) * 8} s): ${(
                finalBufFP.length / 1_048_576
              ).toFixed(1)} MB`
            );
          } catch (extFP) {
            const extFPMsg = (extFP as Error).message;
            const isVeoTimeout =
              extFPMsg.toLowerCase().includes('timed out after') ||
              extFPMsg.includes('Kling Veo timed out');
            if (isVeoTimeout) throw extFP;
            await redisConnection.del(`kie:extendState:${adId}`);
            await redisConnection.del(`kie:extendTask:${adId}`);
            console.warn(`[adWorker] Fast-path extend failed — using initial 8 s clip:`, extFPMsg);
          }
        }

        let klingBuf: Buffer;
        if (finalBufFP) {
          klingBuf = finalBufFP;
        } else {
          const klingRes = await fetch(klingVideoUrl, { signal: AbortSignal.timeout(120_000) });
          if (!klingRes.ok)
            throw new Error(`Kie.ai video download failed: ${klingRes.status}: ${klingVideoUrl}`);
          klingBuf = Buffer.from(await klingRes.arrayBuffer());
        }
        klingBuf = await maybeApplyFishAudioVoice(
          klingBuf,
          ad.avatar?.voiceId,
          ad.dialogueText ?? ''
        );
        const uploadResult = await cloudinary.uploader.upload(
          `data:video/mp4;base64,${klingBuf.toString('base64')}`
        );

        const generatedVideoUrl = uploadResult.secure_url;

        await job.updateProgress(95);
        await prisma.ad.update({
          where: { id: adId },
          data: { generatedVideoUrl, status: 'ready' },
        });
        await prisma.notification.create({
          data: {
            userId: ad.userId,
            event: 'ad_generation_complete',
            message: 'Your ad video is ready.',
            metadata: { adId },
          },
        });
        const adUser = await prisma.user.findUnique({
          where: { id: ad.userId },
          select: { email: true, name: true },
        });
        if (adUser?.email)
          sendAdReadyEmail(adUser.email, adUser.name ?? '', adId).catch(console.error);
        await job.updateProgress(100);
        console.log(`[adWorker] Ad ${adId} resumed and completed successfully`);
        await redisConnection.del(adMutexKey);
        return;
      } catch (resumeErr) {
        const resumeErrMsg = (resumeErr as Error).message;
        if (resumeErrMsg.includes('timed out')) {
          // Transient poll timeout — the Kie.ai task is still alive, just slow.
          // Rethrow so BullMQ retries the job; the next attempt will re-enter
          // this fast-path and resume polling without re-running vision/cinematic.
          console.warn(
            `[adWorker] Fast-path timed out — rethrowing for BullMQ retry (task key preserved)`
          );
          throw resumeErr;
        }
        // Terminal Kie.ai failure (state=fail) — task is dead, clear the key
        // so the next BullMQ retry reaches the submission block and starts fresh.
        await redisConnection.del(kieTaskKey);
        console.warn(
          `[adWorker] Fast-path: terminal Kie.ai failure — clearing stale task key so next retry submits fresh:`,
          resumeErrMsg
        );
        throw resumeErr;
      }
    }
  }

  // ── Auto-prompt: scan product image with vision model ─────────────────────
  // When autoPrompt=true the API saved rawPrompt='' and enhancedPrompt=null.
  // We generate the scene description here and enhance it before use.
  let enhancedPrompt: string = ad.enhancedPrompt ?? ad.rawPrompt;

  if (ad.autoPrompt && !ad.enhancedPrompt) {
    if (!productImageUrls[0]) {
      console.warn('[adWorker] Auto-prompt skipped: no product image');
    } else if (provider === 'kling') {
      // ── Kie.ai path: Gemini 2.5 Flash vision via Kie.ai (same API key, no Google key needed)
      const klingKey = await getProviderKey('kling');
      if (klingKey) {
        try {
          console.log(
            '[adWorker] Auto-prompt: analysing product image with Kie.ai Gemini Vision...'
          );
          const sceneDescription = await kieAnalyzeProductImage(
            productImageUrls[0],
            ad.product?.name ?? 'this product',
            ad.avatar?.name ?? 'the creator',
            adDuration,
            models.kieVisionModel,
            klingKey,
            {
              brandVoice: dialogueCtx.brandVoice,
              productDescription: dialogueCtx.productDescription,
            }
          );
          console.log(`[adWorker] Kie.ai Vision scene: "${sceneDescription}"`);
          enhancedPrompt = enhanceAdPrompt(sceneDescription, aspectRatioStr, {
            avatarName: ad.avatar?.name ?? '',
            productName: ad.product?.name ?? '',
            duration: adDuration,
          });
          await prisma.ad.update({
            where: { id: adId },
            data: { rawPrompt: sceneDescription, enhancedPrompt },
          });
        } catch (vlErr) {
          console.warn(
            '[adWorker] Kie.ai Vision auto-prompt failed — using fallback:',
            (vlErr as Error).message
          );
          enhancedPrompt = enhanceAdPrompt(
            `${ad.product?.name ?? 'Product'} showcase by ${ad.avatar?.name ?? 'creator'}`,
            aspectRatioStr,
            {
              avatarName: ad.avatar?.name ?? '',
              productName: ad.product?.name ?? '',
              duration: adDuration,
            }
          );
        }
      } else {
        console.warn('[adWorker] Auto-prompt skipped: no Kie.ai API key configured');
      }
    } else {
      // ── DashScope path: Qwen VL (dashscope / google / fal / huggingface)
      const aliKeyForVL = await getProviderKey('dashscope');
      if (aliKeyForVL) {
        try {
          console.log('[adWorker] Auto-prompt: analysing product image with Qwen VL...');
          const sceneDescription = await dashscopeAnalyzeProductImage(
            fitCloudinaryDimensions(productImageUrls[0], 384, 2000),
            ad.product?.name ?? 'this product',
            ad.avatar?.name ?? 'the creator',
            adDuration,
            models.visionLlm,
            aliKeyForVL,
            dialogueCtx
          );
          console.log(`[adWorker] Qwen VL scene: "${sceneDescription}"`);
          enhancedPrompt = enhanceAdPrompt(sceneDescription, aspectRatioStr, {
            avatarName: ad.avatar?.name ?? '',
            productName: ad.product?.name ?? '',
            duration: adDuration,
          });
          // Persist so re-runs don't call Qwen VL again
          await prisma.ad.update({
            where: { id: adId },
            data: { rawPrompt: sceneDescription, enhancedPrompt },
          });
        } catch (vlErr) {
          console.warn(
            '[adWorker] Qwen VL auto-prompt failed — using fallback prompt:',
            (vlErr as Error).message
          );
          enhancedPrompt = enhanceAdPrompt(
            `${ad.product?.name ?? 'Product'} showcase by ${ad.avatar?.name ?? 'creator'}`,
            aspectRatioStr,
            {
              avatarName: ad.avatar?.name ?? '',
              productName: ad.product?.name ?? '',
              duration: adDuration,
            }
          );
        }
      } else {
        console.warn('[adWorker] Auto-prompt skipped: missing DashScope API key or product image');
      }
    }
  }

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

    console.log(`[adWorker] Using AI provider: ${provider}`);

    // ── Cinematic timeline prompt expansion (optional) ───────────────────────
    // When cinematic_prompt_enabled=true, a Gemini model rewrites the scene
    // description into a structured Hook → Context → Climax → Resolution brief.
    // Provider routing:
    //   kling   → Kie.ai Gemini chat endpoint (same API key, no Google key needed)
    //   google  → Direct Gemini API (gemini_api_key)
    //   others  → Skipped (can enable by also setting a gemini_api_key)
    const cinematicEnabled = await getAppSetting('cinematic_prompt_enabled');
    if (cinematicEnabled === 'true') {
      const brandVoiceParts2 = [ad.user?.brandVoicePreset, ad.user?.brandVoiceCustom].filter(
        Boolean
      );
      const bv = brandVoiceParts2.length ? brandVoiceParts2.join(', ') : undefined;

      // If enhancedPrompt was already computed and saved in a prior run (before a stall/restart),
      // reuse it directly — skip the expensive LLM call entirely.
      if (ad.enhancedPrompt) {
        enhancedPrompt = ad.enhancedPrompt;
        console.log(
          `[adWorker] Cinematic prompt: reusing saved value from prior run (${enhancedPrompt.length} chars)`
        );
      } else if (provider === 'kling') {
        const klingKey = await getProviderKey('kling');
        if (klingKey) {
          try {
            console.log('[adWorker] Cinematic prompt: expanding with Kie.ai Gemini...');
            // Use kieVisionModel (gemini-2.5-flash via Kie.ai) — NOT cinematicPromptModel
            // which defaults to gemini-2.0-flash, a model Kie.ai does not support.
            enhancedPrompt = await kieCinematicPrompt(
              enhancedPrompt,
              ad.avatar?.name ?? 'the creator',
              ad.product?.name ?? 'this product',
              bv,
              adDuration,
              models.kieVisionModel,
              klingKey,
              aspectRatioStr
            );
            console.log(`[adWorker] Cinematic prompt ready (${enhancedPrompt.length} chars)`);
            await prisma.ad.update({ where: { id: adId }, data: { enhancedPrompt } });
          } catch (cpErr) {
            console.warn(
              '[adWorker] Kie.ai cinematic prompt failed — using original:',
              (cpErr as Error).message
            );
          }
        } else {
          console.warn('[adWorker] Cinematic prompt skipped: no Kie.ai API key configured');
        }
      } else {
        // Google provider path (direct Gemini API key)
        const geminiKey = await getProviderKey('google');
        if (geminiKey) {
          try {
            console.log('[adWorker] Cinematic prompt: expanding with Gemini...');
            enhancedPrompt = await geminiCinematicPrompt(
              enhancedPrompt,
              ad.avatar?.name ?? 'the creator',
              ad.product?.name ?? 'this product',
              bv,
              adDuration,
              models.cinematicPromptModel,
              geminiKey
            );
            console.log(`[adWorker] Cinematic prompt ready (${enhancedPrompt.length} chars)`);
            await prisma.ad.update({ where: { id: adId }, data: { enhancedPrompt } });
          } catch (cpErr) {
            console.warn(
              '[adWorker] Cinematic prompt expansion failed — using original prompt:',
              (cpErr as Error).message
            );
          }
        } else {
          console.warn('[adWorker] Cinematic prompt skipped: no Gemini API key configured');
        }
      }
    }

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
      // ── Alibaba Cloud DashScope — two-step pipeline ───────────────────────
      // Step 1 (optional): wan2.5-i2i-preview fuses avatar photo + product image
      //                    into a single composite image.
      // Step 2:            wan2.6-i2v animates that composite (or falls back to
      //                    avatar-only when no product image is available).
      const aliKey = await getProviderKey('dashscope');
      if (!aliKey) throw new Error('ALIBABA_API_KEY not configured');

      await job.updateProgress(10);

      const productImageUrl = productImageUrls[0] ?? '';
      const hasAvatarPhoto = avatarInputType === 'image' && !!avatarRawUrl;
      const hasProductImage = !!productImageUrl;

      let i2vImageUrl = baseImageUrl; // default: avatar photo (or product fallback)

      if (hasAvatarPhoto && hasProductImage) {
        // ── Step 1: Generate composite image (avatar holding product) ─────
        const productName = ad.product?.name ?? 'product';
        const compositePrompt =
          `The person from Image 1 is holding and prominently showcasing the ${productName} from Image 2. ` +
          `Preserve ALL text, logos, labels, phone numbers, brand names, and fine print on the product packaging exactly as shown in Image 2 — do NOT alter or omit any text. ` +
          `Natural lighting, authentic UGC creator style, close-up shot, person looking at camera, high detail on product.`;

        const sizeStr = `${dimensions.width}*${dimensions.height}`;
        console.log(`[adWorker] Step 1 — generating composite image (${sizeStr})`);

        // DashScope requires input image dimensions in [384, 5000] on each side.
        // fitCloudinaryDimensions scales up images that are too small AND
        // scales down images that are too large.
        const safeAvatarUrl = fitCloudinaryDimensions(avatarRawUrl, 384, 4000);
        const safeProductUrl = fitCloudinaryDimensions(productImageUrl, 384, 4000);

        const imgTaskId = await dashscopeSubmitImageEditTask(
          models.i2iModel,
          [safeAvatarUrl, safeProductUrl],
          compositePrompt,
          sizeStr,
          aliKey
        );

        console.log(`[adWorker] Image edit task submitted: ${imgTaskId}`);
        await job.updateProgress(15);

        i2vImageUrl = await dashscopePollImageTask(imgTaskId, aliKey, 180_000);
        console.log(`[adWorker] Step 1 complete — composite image: ${i2vImageUrl}`);
      } else {
        console.log(
          `[adWorker] Skipping Step 1 — ` +
            `hasAvatarPhoto=${hasAvatarPhoto}, hasProductImage=${hasProductImage}. ` +
            `Using single-image mode.`
        );
      }

      await job.updateProgress(20);

      // ── Step 1.5 (optional): Generate TTS voiceover audio ─────────────────
      let voiceAudioUrl: string | undefined;

      const dialogueLanguage = (ad.dialogueLanguage ?? 'en').toLowerCase();
      let dialogueText = ad.dialogueText ?? '';

      if (ad.autoDialogue && !dialogueText) {
        // Auto-generate dialogue script with Qwen (dialogueCtx built above)
        try {
          console.log(
            `[adWorker] Generating dialogue script (lang=${dialogueLanguage}, company=${dialogueCtx.companyName ?? 'none'}, voice=${dialogueCtx.brandVoice ?? 'default'}, price=${dialogueCtx.price ?? 'none'})...`
          );
          dialogueText = await dashscopeGenerateDialogue(
            ad.product?.name ?? 'this product',
            ad.avatar?.name ?? 'the creator',
            ad.rawPrompt,
            dialogueLanguage,
            adDuration,
            models.dialogueLlm,
            aliKey,
            dialogueCtx
          );
          console.log(`[adWorker] Auto-generated dialogue: "${dialogueText}"`);
        } catch (ttsErr) {
          console.warn(
            '[adWorker] Dialogue auto-generation failed (skipping):',
            (ttsErr as Error).message
          );
          dialogueText = '';
        }
      }

      if (dialogueText) {
        try {
          console.log(`[adWorker] Step 1.5 — generating TTS audio...`);
          const voice = TTS_VOICE_BY_LANGUAGE[dialogueLanguage] ?? TTS_VOICE_BY_LANGUAGE['en']!;
          const audioBuffer = await dashscopeTextToSpeech(
            dialogueText,
            voice,
            models.ttsModel,
            aliKey,
            dialogueLanguage
          );

          // Upload audio to Cloudinary for a permanent, publicly accessible URL
          const audioUpload = await new Promise<{ secure_url: string }>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                resource_type: 'video', // Cloudinary uses 'video' type for audio files
                folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
                public_id: `${adId}_audio`,
                format: 'wav',
              },
              (err, result) => {
                if (err || !result) reject(err ?? new Error('Cloudinary audio upload failed'));
                else resolve(result);
              }
            );
            uploadStream.end(audioBuffer);
          });

          voiceAudioUrl = audioUpload.secure_url;
          console.log(`[adWorker] Step 1.5 complete — audio URL: ${voiceAudioUrl}`);

          // Persist voice audio URL to DB
          await prisma.ad.update({
            where: { id: adId },
            data: { voiceAudioUrl, dialogueText },
          });
        } catch (audioErr) {
          console.warn(
            '[adWorker] TTS generation failed (continuing without audio):',
            (audioErr as Error).message
          );
        }
      }

      await job.updateProgress(30);

      // ── Step 2: Animate the (composite) image with Wan2.6-I2V ────────────
      // wan2.6-i2v supports 2–15 seconds (integer values).
      console.log(
        `[adWorker] Step 2 — animating image, duration=${adDuration}s, ` +
          `mode=${hasAvatarPhoto && hasProductImage ? 'composite' : hasAvatarPhoto ? 'avatar-only' : 'product-only'}` +
          (voiceAudioUrl ? ', with audio' : ', silent')
      );

      const videoInput: Record<string, unknown> = {
        img_url: i2vImageUrl,
        prompt: enhancedPrompt,
        negative_prompt: DASHSCOPE_NEGATIVE_PROMPT,
      };
      if (voiceAudioUrl) {
        videoInput.audio_url = voiceAudioUrl;
      }

      const taskId = await dashscopeSubmitVideoTask(
        models.i2vModel,
        videoInput,
        { resolution: '720P', duration: adDuration, prompt_extend: true },
        aliKey
      );

      console.log(`[adWorker] Video task submitted: ${taskId}`);

      const dashVideoUrl = await dashscopePollVideoTask(
        taskId,
        aliKey,
        (pct) => job.updateProgress(30 + Math.floor(pct * 0.5)),
        600_000 // 10 min
      );

      await job.updateProgress(80);

      const uploadResult = await cloudinary.uploader.upload(dashVideoUrl, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
        public_id: adId,
      });
      generatedVideoUrl = uploadResult.secure_url;
    } else if (provider === 'google') {
      // ── Google Veo 3.1 — reference-image video generation ─────────────────
      // Passes avatar photo + product image as reference images so Veo
      // preserves the person's likeness and the product's appearance.
      const geminiKey = await getProviderKey('google');
      if (!geminiKey) throw new Error('GEMINI_API_KEY not configured');

      // ── Step 1.5: Gemini TTS voiceover ────────────────────────────────────
      let voiceAudioUrl: string | undefined;
      const dialogueText = ad.dialogueText ?? '';

      if (dialogueText) {
        try {
          console.log(`[adWorker] Step 1.5 — generating Gemini TTS audio...`);
          const audioBuffer = await geminiTextToSpeech(
            dialogueText,
            'Kore', // Gemini TTS voice — neutral, multilingual
            models.geminiTtsModel,
            geminiKey
          );
          const audioUpload = await new Promise<{ secure_url: string }>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                resource_type: 'video',
                folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
                public_id: `${adId}_audio`,
                format: 'wav',
              },
              (err, result) => {
                if (err || !result) reject(err ?? new Error('Cloudinary audio upload failed'));
                else resolve(result);
              }
            );
            uploadStream.end(audioBuffer);
          });
          voiceAudioUrl = audioUpload.secure_url;
          console.log(`[adWorker] Step 1.5 complete — audio URL: ${voiceAudioUrl}`);
          await prisma.ad.update({
            where: { id: adId },
            data: { voiceAudioUrl, dialogueText },
          });
        } catch (audioErr) {
          console.warn(
            '[adWorker] Gemini TTS failed (continuing without audio):',
            (audioErr as Error).message
          );
        }
      }

      await job.updateProgress(15);

      // Build reference image list: person first, product second (order matters for Veo)
      const veoRefs: string[] = [];
      if (avatarInputType === 'image' && avatarRawUrl) veoRefs.push(avatarRawUrl);
      if (productImageUrls[0]) veoRefs.push(productImageUrls[0]);

      console.log(
        `[adWorker] Veo — ${veoRefs.length} reference image(s): ` +
          `${avatarInputType === 'image' ? 'avatar+product' : 'product-only'}`
      );

      const veoBuffer = await veoGenerateVideo(
        models.veoModel,
        enhancedPrompt,
        veoRefs,
        geminiKey,
        (pct) => job.updateProgress(20 + Math.floor(pct * 0.6))
      );

      await job.updateProgress(80);

      const veoDataUri = `data:video/mp4;base64,${veoBuffer.toString('base64')}`;
      const uploadResult = await cloudinary.uploader.upload(veoDataUri, {
        resource_type: 'video',
        folder: CLOUDINARY_FOLDERS.GENERATED_ADS,
        public_id: adId,
      });
      generatedVideoUrl = uploadResult.secure_url;
    } else if (provider === 'kling') {
      // ── Kie.ai — Sora 2 / Kling 3.0 / Wan, native audio via prompt injection
      const klingKey = await getProviderKey('kling');
      if (!klingKey) throw new Error('KLING_API_KEY not configured');

      const klingDialogueLanguage = (ad.dialogueLanguage ?? 'en').toLowerCase();
      let klingDialogueText = ad.dialogueText ?? '';

      // ── Auto-generate dialogue ──────────────────────────────────────────────
      if (ad.autoDialogue && !klingDialogueText) {
        try {
          console.log(`[adWorker] Kie.ai: generating dialogue (lang=${klingDialogueLanguage})...`);
          // Always pass 8 — Veo generates 8 s per segment; dialogue goes into the
          // initial clip only. Passing adDuration would ask for too many words
          // and cause the lip sync to degrade badly.
          klingDialogueText = await kieGenerateDialogue(
            ad.product?.name ?? 'this product',
            ad.avatar?.name ?? 'the creator',
            enhancedPrompt,
            klingDialogueLanguage,
            8, // one Veo segment = 8 s; dialogue is for the initial clip only
            models.kieVisionModel,
            klingKey,
            {
              companyName: dialogueCtx.companyName,
              brandVoice: dialogueCtx.brandVoice,
              price: dialogueCtx.price,
              productDescription: dialogueCtx.productDescription,
            }
          );
          await prisma.ad.update({
            where: { id: adId },
            data: { dialogueText: klingDialogueText, dialogueLanguage: klingDialogueLanguage },
          });
        } catch (dlgErr) {
          console.warn(
            '[adWorker] Kie.ai dialogue generation failed — continuing without:',
            (dlgErr as Error).message
          );
        }
      }

      // ── Build final prompt ──────────────────────────────────────────────────
      // Inject dialogue lines, language instruction, and price hint so Sora
      // synthesises speech and mentions the product price natively.
      const langNames: Record<string, string> = {
        en: 'English',
        ar: 'Arabic',
        fr: 'French',
        es: 'Spanish',
        de: 'German',
        ja: 'Japanese',
        ko: 'Korean',
        zh: 'Chinese',
      };
      const spokenLang = langNames[klingDialogueLanguage] ?? 'English';

      let klingPrompt =
        'The video opens with immediate natural motion — no freeze frame, no static opening. ' +
        'The creator appears in a completely new scene — the original background from any reference ' +
        'image is entirely replaced by the environment described in this prompt. ' +
        'STRICT: No on-screen text, captions, subtitles, price overlays, or graphic titles. ' +
        'Include dynamic cinematic product shots: alternate between creator talking and close-up ' +
        'beauty shots of the product — extreme macro, rack-focus, slow-motion texture reveals. ' +
        enhancedPrompt;
      if (klingDialogueText) {
        klingPrompt += `\n\nSpoken line in ${spokenLang} (8 seconds max): "${klingDialogueText}"`;
        klingPrompt +=
          `\nThe creator speaks these exact words naturally and conversationally in ${spokenLang}. ` +
          `PERFECT LIP SYNC — every syllable is visibly matched by natural, expressive mouth movements. ` +
          `Delivery is authentic, like a real person talking to their phone camera — NOT a formal ad.`;
      } else {
        klingPrompt += `\nThe creator speaks naturally in ${spokenLang} with perfect lip sync.`;
      }

      await job.updateProgress(15);

      // Reference image strategy:
      // veo3_fast → REFERENCE_2_VIDEO: images are style/character references, NOT anchor frames.
      //   Send avatar first (character identity), then product (visual context). The model
      //   generates a fresh scene; it does NOT show these images as literal video frames.
      // veo3 (quality) → FIRST_AND_LAST_FRAMES_2_VIDEO: images ARE literal anchor frames.
      //   Only send the avatar — never the product — to avoid a static product shot as
      //   the opening frame. The prompt describes the product visually instead.
      const klingRefs: string[] = [];
      if (models.klingVeoModel === 'veo3_fast') {
        if (avatarInputType === 'image' && avatarRawUrl) klingRefs.push(avatarRawUrl);
        if (productImageUrls[0]) klingRefs.push(productImageUrls[0]);
        // Add brand logo as 3rd visual reference when available (REFERENCE_2_VIDEO supports up to 3)
        if (ad.user?.companyLogoUrl) klingRefs.push(ad.user.companyLogoUrl);
      } else {
        // veo3 quality — only avatar as character anchor
        if (avatarInputType === 'image' && avatarRawUrl) klingRefs.push(avatarRawUrl);
      }

      console.log(
        `[adWorker] Kling Veo — model=${models.klingVeoModel}, ` +
          `${klingRefs.length} reference image(s), lang=${spokenLang}` +
          (klingDialogueText ? ', with dialogue' : ', no dialogue')
      );

      // ── Kie.ai task ID persistence (Redis) ─────────────────────────────────
      // Store the taskId in Redis right after submission so that if this
      // worker process is restarted mid-poll (e.g. Render redeploy), the
      // retried job can RESUME polling the existing Kie.ai task instead of
      // submitting a brand-new one (which wastes credits).
      const kieTaskKey = `kie:pendingTask:${adId}`;
      let klingTaskId = await redisConnection.get(kieTaskKey);
      if (klingTaskId) {
        console.log(`[adWorker] Resuming existing Kie.ai task ${klingTaskId}`);
      } else if (LEGACY_VEO_MODELS.has(models.klingVeoModel)) {
        // Legacy Veo 3.1 path — uses /api/v1/veo/generate + /api/v1/veo/record-info
        klingTaskId = await submitKlingVeoLegacy(
          models.klingVeoModel,
          klingPrompt,
          klingRefs,
          klingKey,
          aspectRatioStr,
          adDuration
        );
        // TTL: 4 hours — survives multiple 30-min retry cycles
        await redisConnection.set(kieTaskKey, klingTaskId, 'EX', 14400);
      } else {
        // Unified API path — Sora 2, Kling, Wan, etc.
        klingTaskId = await klingVeoSubmitTask(
          models.klingVeoModel,
          klingPrompt,
          klingRefs,
          klingKey,
          adDuration
        );
        // TTL: 4 hours — survives multiple 30-min retry cycles
        await redisConnection.set(kieTaskKey, klingTaskId, 'EX', 14400); // 4 h — survives multiple 30-min retry cycles
      }

      let klingVideoUrl: string;
      try {
        klingVideoUrl = LEGACY_VEO_MODELS.has(models.klingVeoModel)
          ? await klingVeoPoll(klingTaskId, klingKey, (pct) =>
              job.updateProgress(20 + Math.floor(pct * 0.6))
            )
          : await klingVeoPollTask(klingTaskId, klingKey, (pct) =>
              job.updateProgress(20 + Math.floor(pct * 0.6))
            );
      } catch (pollErr) {
        const pollErrMsg = (pollErr as Error).message;
        // Terminal Kie.ai failure (state=fail) — discard the dead task ID so the
        // next BullMQ retry reaches the submission block and starts a new task.
        // Transient poll timeouts keep the key to resume on the next attempt.
        if (!pollErrMsg.includes('timed out')) {
          await redisConnection.del(kieTaskKey);
          console.warn(
            `[adWorker] Kie.ai terminal failure — clearing Redis task key so next retry submits fresh:`,
            pollErrMsg
          );
        }
        throw pollErr;
      }

      // Task complete — remove the Redis resume key
      await redisConnection.del(kieTaskKey);

      await job.updateProgress(80);

      // ── Extend to target duration ────────────────────────────────────────────
      // 8s → 0 extends, 16s → 1, 24s → 2, 32s → 3
      const numExtensions = Math.min(3, Math.max(0, Math.ceil(adDuration / 8) - 1));
      const initialKlingVideoUrl = klingVideoUrl;
      let finalKlingBuffer: Buffer | null = null;
      if (LEGACY_VEO_MODELS.has(models.klingVeoModel) && numExtensions > 0) {
        const veoExtendModel = models.klingVeoModel === 'veo3_fast' ? 'fast' : 'quality';
        const segmentPrompts = buildVeoSegmentPrompts(
          ad.product?.name ?? 'the product',
          ad.avatar?.name ?? 'the creator',
          spokenLang,
          numExtensions
        );
        const initState = {
          numExtensions,
          partUrls: [klingVideoUrl],
          prevTaskId: klingTaskId,
        };
        try {
          finalKlingBuffer = await runVeoExtendLoop(
            adId,
            initState,
            veoExtendModel,
            segmentPrompts,
            klingKey,
            (pct) => job.updateProgress(80 + Math.floor(pct * 0.15))
          );
          console.log(
            `[adWorker] Veo extend+concat done (~${(numExtensions + 1) * 8} s): ${(
              finalKlingBuffer.length / 1_048_576
            ).toFixed(1)} MB`
          );
        } catch (extendErr) {
          const extendErrMsg = (extendErr as Error).message;
          const isVeoApiTimeout =
            extendErrMsg.toLowerCase().includes('timed out after') ||
            extendErrMsg.includes('Kling Veo timed out');
          if (isVeoApiTimeout) throw extendErr;
          await Promise.all([
            redisConnection.del(`kie:extendTask:${adId}`),
            redisConnection.del(`kie:extendState:${adId}`),
          ]);
          console.warn(
            `[adWorker] Veo extend/concat failed — falling back to initial ~8 s clip:`,
            extendErrMsg
          );
          console.warn(`[adWorker] Full extend error:`, extendErr);
        }
      }

      // Download and upload to Cloudinary
      let klingBuffer: Buffer;
      if (finalKlingBuffer) {
        klingBuffer = finalKlingBuffer;
      } else {
        const klingRes = await fetch(initialKlingVideoUrl, {
          signal: AbortSignal.timeout(120_000),
        });
        if (!klingRes.ok)
          throw new Error(
            `Kie.ai video download failed: ${klingRes.status}: ${initialKlingVideoUrl}`
          );
        klingBuffer = Buffer.from(await klingRes.arrayBuffer());
      }
      klingBuffer = await maybeApplyFishAudioVoice(
        klingBuffer,
        ad.avatar?.voiceId,
        klingDialogueText
      );
      const klingDataUri = `data:video/mp4;base64,${klingBuffer.toString('base64')}`;
      const uploadResult = await cloudinary.uploader.upload(klingDataUri, {
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

    // ── Google Drive backup (optional) ────────────────────────────────────────
    // Runs after Cloudinary upload. Downloads the video from Cloudinary and
    // mirrors it to the configured Drive folder. Failures are non-fatal — the
    // ad is marked ready regardless.
    const storageConfig = await getStorageConfig();
    if (
      storageConfig.backup === 'cloudinary_gdrive' &&
      storageConfig.gdriveFolderId &&
      storageConfig.gdriveClientId &&
      storageConfig.gdriveClientSecret &&
      storageConfig.gdriveRefreshToken
    ) {
      (async () => {
        try {
          console.log(`[adWorker] Drive backup: downloading from Cloudinary...`);
          const dlRes = await fetch(generatedVideoUrl, { signal: AbortSignal.timeout(120_000) });
          if (!dlRes.ok)
            throw new Error(`Cloudinary fetch for Drive backup failed: ${dlRes.status}`);
          const dlBuffer = Buffer.from(await dlRes.arrayBuffer());
          const driveUrl = await uploadToGoogleDrive(
            dlBuffer,
            `ad_${adId}.mp4`,
            storageConfig.gdriveFolderId!,
            storageConfig.gdriveClientId!,
            storageConfig.gdriveClientSecret!,
            storageConfig.gdriveRefreshToken!
          );
          console.log(`[adWorker] Drive backup complete: ${driveUrl}`);
          // Persist the Drive URL non-critically
          await prisma.ad.update({ where: { id: adId }, data: { driveBackupUrl: driveUrl } });
        } catch (driveErr) {
          console.warn('[adWorker] Drive backup failed (non-fatal):', (driveErr as Error).message);
        }
      })();
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
    await redisConnection.del(adMutexKey);
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

    await redisConnection.del(adMutexKey).catch(console.error);
    throw err;
  }
}

export const adGenerationWorker = new Worker<{ adId: string }>(
  QUEUE_NAMES.AD_GENERATION,
  processAdJob,
  {
    connection: redisConnection,
    concurrency: 2,
    // Upstash Redis free tier: 500k requests/month.
    // Default drainDelay=5ms causes ~200 req/s per worker when idle — burns the limit in hours.
    // 5 000ms idle poll = 12 req/min max (vs 12 000/min default).
    drainDelay: 5_000,
    // Stalled-job check: every 60s — fast recovery after Render deploys.
    stalledInterval: 60_000,
    // Lock duration: 5 min. Veo jobs can take 10-20 min; BullMQ auto-renews
    // every lockDuration/2 = 150s. A 5-min lock means the Redis connection can
    // be offline for up to ~150s before the lock expires (Redis upgrades on
    // Render typically take 30-90s). Combined with indefinite retry strategy
    // and enableOfflineQueue=true, lock renewals will be queued and flushed
    // once the connection recovers — avoiding false stall failures.
    lockDuration: 300_000,
    // Allow up to 3 stall events before moving a job to failed.
    // Render deploys kill the process mid-poll; the new instance resumes via
    // the Redis kieTaskId key — so each stall is a safe, resumable restart.
    maxStalledCount: 3,
    skipVersionCheck: true,
  }
);

adGenerationWorker.on('failed', (job, err) => {
  console.error(`[adWorker] Job ${job?.id} failed:`, err.message);
});
