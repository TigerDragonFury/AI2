/**
 * Kie.ai video generation helper.
 *
 * Supports two API generations:
 *
 *   LEGACY (Veo 3.1 via kie.ai) — models: 'veo3', 'veo3_fast'
 *     POST /api/v1/veo/generate  →  GET /api/v1/veo/record-info
 *     Polls successFlag: 0=generating, 1=success, 2/3=failed
 *
 *   UNIFIED (Sora 2, Kling 3.0/2.1, Wan, Hailuo…) — all other model IDs
 *     POST /api/v1/jobs/createTask  →  GET /api/v1/jobs/recordInfo
 *     Polls state: 'waiting'|'queuing'|'generating'|'success'|'fail'
 *     Result in resultJson: '{ "resultUrls": ["https://..."] }'
 *
 * Set env: KLING_API_KEY=<kie.ai API key>   AI_PROVIDER=kling
 */

import { execFile } from 'child_process';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const KLING_BASE = 'https://api.kie.ai';
const POLL_INTERVAL_MS = 5_000; // 5 s between polls
const MAX_POLLS = 360; // 30 minutes max — Kie.ai's nominal window is 20 min but
// jobs at 99% can linger; 30 min gives a 10-min buffer before we declare timeout.

// Models that still use the legacy Veo endpoint
export const LEGACY_VEO_MODELS = new Set(['veo3', 'veo3_fast']);

// Models routing
const SORA2_I2V_MODEL = 'sora-2-pro-image-to-video';
const SORA2_T2V_MODEL = 'sora-2-pro-text-to-video';

// ─── Legacy Veo API types ─────────────────────────────────────────────────────

interface VeoSubmitResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}

interface VeoPollResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    successFlag: number; // 0=generating, 1=success, 2/3=failed
    errorMessage?: string;
    response?: { resultUrls?: string[]; resolution?: string };
  };
}

// ─── Unified API types ────────────────────────────────────────────────────────

interface UnifiedSubmitResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}

interface UnifiedPollResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
    failMsg?: string;
    resultJson?: string; // JSON string: '{ "resultUrls": ["https://..."] }'
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Download a video URL and return a Buffer. */
async function downloadVideo(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Video download error ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Concatenate N MP4 buffers in order.
 *
 * When `trimExtStartSec > 0` (default 0.5 s), the start of every segment after
 * the first is trimmed by that amount before concatenating.  This removes the
 * duplicated boundary frames that the Veo extend API produces — the extension
 * clip starts from the last frame of the previous clip, so there is a ~0.5 s
 * overlap that must be discarded before joining.
 *
 * Uses ffmpeg filter_complex when trimming; falls back to the concat demuxer
 * (-c copy, lossless) when no trimming is needed.
 */
export async function concatVideos(buffers: Buffer[], trimExtStartSec = 0.5): Promise<Buffer> {
  if (buffers.length === 1) return buffers[0];

  const dir = await mkdtemp(join(tmpdir(), 'veo-concat-'));
  const outFile = join(dir, 'merged.mp4');
  try {
    const filePaths = await Promise.all(
      buffers.map(async (buf, i) => {
        const p = join(dir, `raw${i}.mp4`);
        await writeFile(p, buf);
        return p;
      })
    );

    const N = filePaths.length;
    const trimSec = trimExtStartSec > 0 ? trimExtStartSec : 0;

    if (trimSec <= 0) {
      // Fast lossless path — no trimming needed
      const listFile = join(dir, 'list.txt');
      await writeFile(listFile, filePaths.map((p) => `file '${p}'`).join('\n') + '\n');
      await new Promise<void>((res, rej) =>
        execFile(
          'ffmpeg',
          ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', outFile],
          { timeout: 180_000 },
          (err, _, stderr) =>
            err ? rej(new Error(`ffmpeg concat failed: ${stderr || err.message}`)) : res()
        )
      );
    } else {
      // filter_complex path: trim leading overlap off segments 1..N-1,
      // normalise PTS on all segments, then concat in one re-encode pass.
      const inputs = filePaths.flatMap((p) => ['-i', p]);
      const fc: string[] = [];
      const vLabels: string[] = [];
      const aLabels: string[] = [];

      for (let i = 0; i < N; i++) {
        if (i === 0) {
          fc.push(`[0:v]setpts=PTS-STARTPTS[v0]`);
          fc.push(`[0:a]asetpts=PTS-STARTPTS[a0]`);
        } else {
          fc.push(`[${i}:v]trim=start=${trimSec},setpts=PTS-STARTPTS[v${i}]`);
          fc.push(`[${i}:a]atrim=start=${trimSec},asetpts=PTS-STARTPTS[a${i}]`);
        }
        vLabels.push(`[v${i}]`);
        aLabels.push(`[a${i}]`);
      }

      const pairs = vLabels.map((v, i) => v + aLabels[i]).join('');
      fc.push(`${pairs}concat=n=${N}:v=1:a=1[vout][aout]`);

      await new Promise<void>((res, rej) =>
        execFile(
          'ffmpeg',
          [
            ...inputs,
            '-filter_complex',
            fc.join(';'),
            '-map',
            '[vout]',
            '-map',
            '[aout]',
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '18',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            '-y',
            outFile,
          ],
          { timeout: 300_000 },
          (err, _, stderr) =>
            err
              ? rej(new Error(`ffmpeg filter_complex concat failed: ${stderr || err.message}`))
              : res()
        )
      );
    }

    return await readFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Legacy Veo path ─────────────────────────────────────────────────────────

export async function klingVeoPoll(
  taskId: string,
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${KLING_BASE}/api/v1/veo/record-info?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Kling Veo poll error ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as VeoPollResponse;
    const d = json.data;
    if (!d) throw new Error(`Kling Veo poll returned no data: ${JSON.stringify(json)}`);

    if (d.successFlag === 2 || d.successFlag === 3) {
      throw new Error(`Kling Veo generation failed: ${d.errorMessage ?? 'unknown error'}`);
    }
    if (d.successFlag === 1) {
      const url = d.response?.resultUrls?.[0];
      if (!url) throw new Error(`Kling Veo done but no URL in: ${JSON.stringify(d.response)}`);
      console.log(`[Kling/Veo] Done (${d.response?.resolution ?? '?'}) — ${url}`);
      return url;
    }

    const pct = Math.floor((i / MAX_POLLS) * 100);
    console.log(`[Kling/Veo] Poll ${i + 1}/${MAX_POLLS} (~${pct}%)`);
    onProgress?.(pct);
  }
  throw new Error(`Kling Veo timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} min`);
}

export async function submitKlingVeoLegacy(
  model: string,
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  aspectRatio: string = '9:16',
  durationSec: number = 8
): Promise<string> {
  // Veo 3.1 has no native duration parameter — the model always outputs ~8 seconds.
  // Injecting it into the prompt is the only lever we have to influence clip length.
  const durationHint = `The video must be exactly ${Math.round(durationSec)} seconds long. `;
  const validUrls = imageUrls.filter(Boolean).slice(0, 3);
  let generationType: string;
  let submittedUrls = validUrls;

  if (validUrls.length > 0) {
    if (model === 'veo3_fast') {
      // REFERENCE_2_VIDEO treats images as character/style references — NOT anchor frames.
      // This is the correct mode for ads: the model generates a new cinematic scene using
      // the images as visual context, ignoring their backgrounds.
      // Kie.ai docs table confirms REFERENCE_2_VIDEO supports both 16:9 and 9:16 for veo3_fast.
      generationType = 'REFERENCE_2_VIDEO';
      submittedUrls = validUrls.slice(0, 3);
    } else {
      // veo3 (quality) does not support REFERENCE_2_VIDEO.
      // FIRST_AND_LAST_FRAMES_2_VIDEO uses images as literal anchor frames, so only pass
      // the avatar (character reference). Never pass the product image here — it would
      // appear as a literal static frame at the start of the video.
      generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
      submittedUrls = validUrls.slice(0, 1); // only avatar
    }
  } else {
    generationType = 'TEXT_2_VIDEO';
    submittedUrls = [];
  }

  console.log(
    `[Kling/Veo] Submit model=${model}, mode=${generationType}, refs=${submittedUrls.length}`
  );

  const res = await fetch(`${KLING_BASE}/api/v1/veo/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: durationHint + prompt,
      ...(submittedUrls.length > 0 && { imageUrls: submittedUrls }),
      model,
      generationType,
      aspect_ratio: aspectRatio,
      enableTranslation: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Kling Veo submit error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as VeoSubmitResponse;
  if (json.code !== 200 || !json.data?.taskId) {
    throw new Error(`Kling Veo submit failed (code ${json.code}): ${json.msg}`);
  }
  return json.data.taskId;
}

/**
 * Extend an existing Veo 3.1 video by ~8 s using the /api/v1/veo/extend endpoint.
 * Returns the new taskId which can be polled with klingVeoPoll (same record-info endpoint).
 */
export async function submitKlingVeoExtend(
  /** taskId returned from the ORIGINAL generation (submitKlingVeoLegacy) */
  originalTaskId: string,
  prompt: string,
  /** 'fast' for veo3_fast, 'quality' for veo3 */
  model: 'fast' | 'quality',
  apiKey: string
): Promise<string> {
  console.log(`[Kling/Veo] Submitting extend for task=${originalTaskId}, model=${model}`);
  const res = await fetch(`${KLING_BASE}/api/v1/veo/extend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: originalTaskId, prompt, model }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Kling Veo extend submit error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as VeoSubmitResponse;
  if (json.code !== 200 || !json.data?.taskId) {
    throw new Error(`Kling Veo extend submit failed (code ${json.code}): ${json.msg}`);
  }
  console.log(`[Kling/Veo] Extend task submitted: ${json.data.taskId}`);
  return json.data.taskId;
}

// ─── Unified API path ────────────────────────────────────────────────────────

/** Poll a Kie.ai task until done and return the video URL. */
export async function klingVeoPollTask(
  taskId: string,
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${KLING_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Kie.ai poll error ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as UnifiedPollResponse;
    const d = json.data;
    if (!d) throw new Error(`Kie.ai poll returned no data: ${JSON.stringify(json)}`);

    if (d.state === 'fail') {
      throw new Error(`Kie.ai generation failed: ${d.failMsg ?? 'unknown error'}`);
    }
    if (d.state === 'success') {
      const parsed = d.resultJson
        ? (JSON.parse(d.resultJson) as { resultUrls?: string[] })
        : undefined;
      const url = parsed?.resultUrls?.[0];
      if (!url) throw new Error(`Kie.ai done but no URL in resultJson: ${d.resultJson}`);
      console.log(`[Kie.ai] Done — ${url}`);
      return url;
    }

    const pct = Math.floor((i / MAX_POLLS) * 100);
    console.log(`[Kie.ai] Poll ${i + 1}/${MAX_POLLS} state=${d.state} (~${pct}%)`);
    onProgress?.(pct);
  }
  throw new Error(`Kie.ai job timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} min`);
}

/** Build the `input` object for the unified createTask endpoint. */
function buildUnifiedInput(
  model: string,
  prompt: string,
  imageUrls: string[],
  durationSec = 10
): Record<string, unknown> {
  const validUrls = imageUrls.filter(Boolean);
  const hasImages = validUrls.length > 0;
  const durStr = String(Math.max(1, Math.round(durationSec)));
  // Sora 2 API n_frames accepts "10" or "15" (bare number strings).
  // "10s"/"15s" are only UI labels on the playground — not valid API values.
  const sora2NFrames = durationSec >= 13 ? '15' : '10';

  // ── Sora 2 models ──────────────────────────────────────────────────────────
  if (model === SORA2_I2V_MODEL || (model === SORA2_T2V_MODEL && hasImages)) {
    // Auto-upgrade T2V to I2V when images are available
    return {
      prompt,
      image_urls: validUrls.slice(0, 3),
      aspect_ratio: 'landscape',
      n_frames: sora2NFrames,
      size: 'high',
      remove_watermark: true,
    };
  }
  if (model === SORA2_T2V_MODEL) {
    return {
      prompt,
      aspect_ratio: 'landscape',
      n_frames: sora2NFrames,
      size: 'high',
      remove_watermark: true,
    };
  }

  // ── Kling models (v3.0, v2-1-pro, v2-1-standard, etc.) ───────────────────
  if (model.startsWith('kling/')) {
    if (hasImages) {
      return {
        prompt,
        image_url: validUrls[0], // Kling I2V takes a single image
        duration: durStr,
        negative_prompt: '',
        cfg_scale: 0.5,
      };
    }
    return { prompt, duration: durStr, negative_prompt: '', aspect_ratio: '16:9', cfg_scale: 0.5 };
  }

  // ── Wan model ─────────────────────────────────────────────────────────────
  if (model.startsWith('wan/')) {
    return hasImages
      ? { prompt, image_url: validUrls[0], duration: durStr }
      : { prompt, aspect_ratio: '16:9', duration: durStr };
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  return hasImages ? { prompt, image_url: validUrls[0] } : { prompt };
}

/** Submit a video-generation task to Kie.ai and return the taskId. */
export async function klingVeoSubmitTask(
  model: string,
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  durationSec = 10
): Promise<string> {
  const input = buildUnifiedInput(model, prompt, imageUrls, durationSec);
  const effectiveModel =
    model === SORA2_T2V_MODEL && imageUrls.filter(Boolean).length > 0
      ? SORA2_I2V_MODEL // auto-upgrade
      : model;

  console.log(
    `[Kie.ai] Submit model=${effectiveModel}, images=${imageUrls.filter(Boolean).length}, prompt="${prompt.slice(0, 80)}..."`
  );

  const res = await fetch(`${KLING_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: effectiveModel, input }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Kie.ai createTask error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as UnifiedSubmitResponse;
  if (json.code !== 200 || !json.data?.taskId) {
    throw new Error(`Kie.ai createTask failed (code ${json.code}): ${json.msg}`);
  }
  console.log(`[Kie.ai] Task created: ${json.data.taskId}`);
  return json.data.taskId;
}

// ─── Kie.ai Chat / Vision API (Gemini models routed through Kie.ai) ───────────

// Kie.ai Gemini 2.5 Flash returns content as either:
//   • a plain string (when include_thoughts=false)
//   • an array of { type: 'thinking'|'text', text: string } (when thoughts are on)
// We always set include_thoughts:false to get a plain string, but the helper
// below handles both forms defensively.
type KieContentPart = { type?: string; text?: string };
interface KieChatResponse {
  choices?: Array<{
    message?: { content?: string | KieContentPart[] };
  }>;
}

/** Extract the plain-text response from a Kie.ai chat completion. */
function extractKieText(json: KieChatResponse): string | undefined {
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw.trim() || undefined;
  // Array of content parts — find the first 'text' (non-thinking) part
  const parts = Array.isArray(raw) ? raw : [];
  const textPart = parts.find((p) => p.type === 'text' && p.text) ?? parts.find((p) => p.text);
  return textPart?.text?.trim() || undefined;
}

/**
 * POST to a Kie.ai chat completions endpoint with one automatic retry on
 * transient failures (5xx, network error, timeout).  Returns the parsed JSON.
 */
async function kieChat(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs = 90_000
): Promise<KieChatResponse> {
  const attempt = async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Kie.ai chat error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as KieChatResponse & { code?: number; msg?: string };
    // Kie.ai returns 200 with { code: 500, msg: "Server exception" } for server errors
    if (json.code && json.code >= 500) throw new Error(`Kie.ai server error: ${json.msg}`);
    return json as KieChatResponse;
  };
  try {
    return await attempt();
  } catch (err) {
    // One retry after a 4-second pause for transient errors
    console.warn(`[Kie.ai] Chat attempt failed (${(err as Error).message}), retrying in 4s...`);
    await new Promise((r) => setTimeout(r, 4_000));
    return attempt();
  }
}

/**
 * Auto-generate a short spoken dialogue script for a UGC ad via Kie.ai Gemini.
 * Mirrors dashscopeGenerateDialogue() for the kling provider path —
 * same prompt structure, same language support, no extra API key needed.
 */
export async function kieGenerateDialogue(
  productName: string,
  avatarName: string,
  sceneDescription: string,
  language: string,
  durationSec: number,
  model: string,
  apiKey: string,
  ctx?: { companyName?: string; brandVoice?: string; price?: string; productDescription?: string }
): Promise<string> {
  // Veo 3.1 always generates 8 s per segment — calibrate word count to that window.
  // ~2 words/second is natural, conversational speech (120–130 WPM).
  // Never ask for more words than the video can comfortably deliver.
  const effectiveSec = Math.min(durationSec, 8);
  const wordLimit = Math.max(8, Math.round(effectiveSec * 2));
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
  const langName = langNames[language] ?? 'English';

  const brandTone = ctx?.brandVoice
    ? `Brand tone / voice: ${ctx.brandVoice}. Match this tone throughout.`
    : '';
  const brandName = ctx?.companyName ? `Brand name: "${ctx.companyName}". ` : '';
  const priceInstruction = ctx?.price
    ? `The product costs ${ctx.price} — work this price into the CTA naturally (e.g. "Only ${ctx.price}!"). `
    : '';
  const productDescLine = ctx?.productDescription
    ? `Product details: ${ctx.productDescription}. `
    : '';

  const systemPrompt =
    `You are a professional UGC ad creator writing AUTHENTIC, NATURAL spoken lines for a short video. ` +
    `You MUST write ONLY in ${langName} — every single word of your response must be in ${langName}. ` +
    `Write as if a REAL PERSON is casually talking to their phone camera — NOT a formal advertisement. ` +
    `Sound like a genuine recommendation from a friend: conversational, warm, spontaneous. ` +
    `Highlight ONE concrete benefit and end with a brief call to action. ` +
    `NEVER narrate what the person is doing — speak TO the viewer. ` +
    `Keep it SHORT — every word must fit naturally in ${effectiveSec} seconds of relaxed speech. ${brandTone}`;

  const userPrompt =
    `${brandName}${productDescLine}${priceInstruction}` +
    `Write a natural, conversational spoken line (MAX ${wordLimit} words) in ${langName} for the ` +
    `FIRST 8 seconds of a UGC video ad for "${productName}" by ${avatarName}. ` +
    `It must sound like something a real person would naturally say — casual, authentic, energetic. ` +
    `Context: ${sceneDescription}. ` +
    `Output ONLY the spoken words — no stage directions, no labels, no quotes.`;

  const json = await kieChat(
    `${KLING_BASE}/${model}/v1/chat/completions`,
    apiKey,
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      include_thoughts: false,
    },
    90_000
  );
  const text = extractKieText(json);
  if (!text) throw new Error('Kie.ai dialogue generation returned no text');
  console.log(`[Kie.ai Dialogue] Generated (${text.length} chars, lang=${language}): "${text}"`);
  return text;
}

/**
 * Analyse a product image using Kie.ai's Gemini 2.5 Flash vision model.
 * Same API key as video generation — no extra credentials needed.
 * Mirrors dashscopeAnalyzeProductImage() for the kling provider path.
 */
export async function kieAnalyzeProductImage(
  imageUrl: string,
  productName: string,
  avatarName: string,
  durationSec: number,
  model: string,
  apiKey: string,
  ctx?: { brandVoice?: string; productDescription?: string }
): Promise<string> {
  const brandToneHint = ctx?.brandVoice
    ? ` The brand tone is: ${ctx.brandVoice}. Let this influence the mood and energy of the scene description.`
    : '';
  const productDetailHint = ctx?.productDescription
    ? ` Additional product detail: ${ctx.productDescription}.`
    : '';

  const instruction =
    `You are an expert UGC ad director. Study this product image carefully. ` +
    `Write a single vivid scene description (1-2 sentences, max 180 characters) for a ${durationSec}-second UGC video ad. ` +
    `The creator named "${avatarName || 'the creator'}" is showcasing "${productName}". ` +
    `Describe: what action the creator is performing with the product, their expression, and the mood. ` +
    `Start with an action verb. Be specific about the product based on what you see in the image.` +
    brandToneHint +
    productDetailHint +
    ` Output ONLY the scene description — no titles, no explanations.`;

  const json = await kieChat(
    `${KLING_BASE}/${model}/v1/chat/completions`,
    apiKey,
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      stream: false,
      include_thoughts: false,
    },
    90_000
  );
  const text = extractKieText(json);
  if (!text)
    throw new Error(`Kie.ai vision returned no text: ${JSON.stringify(json).slice(0, 200)}`);
  console.log(`[Kie.ai Vision] Scene: "${text.slice(0, 120)}"`);
  return text;
}

/**
 * Generate a cinematic timeline prompt (Hook→Context→Climax→Resolution) using
 * Kie.ai's Gemini 2.5 Flash. Same API key as video generation.
 * Mirrors geminiCinematicPrompt() in google.ts for the kling provider path.
 */
export async function kieCinematicPrompt(
  sceneDescription: string,
  avatarName: string,
  productName: string,
  brandVoice: string | undefined,
  durationSec: number,
  model: string,
  apiKey: string,
  aspectRatio: string = '9:16'
): Promise<string> {
  const t1 = Math.round(durationSec * 0.25);
  const t2 = Math.round(durationSec * 0.5);
  const t3 = Math.round(durationSec * 0.75);
  const formatLabel =
    aspectRatio === '16:9'
      ? 'landscape 16:9'
      : aspectRatio === '1:1'
        ? 'square 1:1'
        : 'portrait 9:16';

  const systemInstruction =
    `You are an expert film director and UGC video ad specialist. ` +
    `Transform the provided scene description into a single cohesive video generation prompt ` +
    `structured as a cinematic timeline. The output must be plain text — NO markdown, NO bullet ` +
    `list symbols, NO headers. Write it as a single block a video model can parse directly.\n\n` +
    `CRITICAL — Background & Scene: The reference image provides ONLY the creator's appearance ` +
    `and identity. Their original background must be COMPLETELY REPLACED by a new, vivid, ` +
    `specific environment that serves the product story. Describe this new setting in rich ` +
    `detail — lighting, surfaces, atmosphere, depth — so the video model renders a fresh scene.\n\n` +
    `STRICT RULES — MUST FOLLOW:\n` +
    `1. NEVER render on-screen text, captions, subtitles, price tags, banners, or graphic overlays.\n` +
    `2. All spoken words must be in the language specified by the caller — never default to English.\n` +
    `3. PERFECT LIP SYNC: describe natural expressive mouth movements matching every syllable.\n` +
    `4. Cinematic camera work: push-ins, rack-focus, close-ups, Dutch angles, slow-motion moments.\n\n` +
    `Required structure (fill in — do NOT output the bracket labels):\n` +
    `[VIBE: energetic/luxury/playful/warm/bold] [FORMAT: ${formatLabel}] [GENRE: UGC cinematic ad] — ` +
    `[0–${t1}s HOOK: explosive opening action, dynamic camera motion, vivid lighting in new scene] — ` +
    `[${t1}–${t2}s CONTEXT: creator interacts with product, speaks to camera, tight framing] — ` +
    `[${t2}–${t3}s CLIMAX: key benefit close-up, product hero shot, peak emotion, rack-focus] — ` +
    `[${t3}–${durationSec}s RESOLUTION: authentic satisfied reaction, soft CTA spoken to camera] — ` +
    `[SCENE: 2-sentence vivid environment description that elevates the product story]`;

  const userContent =
    `Product: ${productName}\n` +
    `Creator/Avatar: ${avatarName}\n` +
    (brandVoice ? `Brand voice: ${brandVoice}\n` : '') +
    `Duration: ${durationSec} seconds\n` +
    `Scene description: ${sceneDescription}\n\n` +
    `Write the cinematic timeline prompt now.`;

  const json = await kieChat(
    `${KLING_BASE}/${model}/v1/chat/completions`,
    apiKey,
    {
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
      stream: false,
      include_thoughts: false,
    },
    60_000
  );
  const text = extractKieText(json);
  if (!text) {
    console.error('[Kie.ai Cinematic] Raw response:', JSON.stringify(json).slice(0, 1000));
    throw new Error('Kie.ai cinematic prompt returned no text');
  }
  console.log(`[Kie.ai Cinematic] Generated timeline prompt (${text.length} chars)`);
  return text;
}

/**
 * Generate per-segment continuation scene prompts for multi-segment Veo ads.
 * Each extension segment is ~8 s. Returns `numExtensions` prompts (one per
 * extend call), each describing a distinct cinematic scene that flows from
 * the previous one.
 *
 * Segment roles:
 *   0 (initial clip, NOT returned): creator hook — already handled by kieCinematicPrompt
 *   1st extension: product close-up beauty shots + feature demo
 *   2nd extension: creator mid-scene, interaction / benefit statement
 *   3rd extension: call to action + brand moment
 */
export function buildVeoSegmentPrompts(
  productName: string,
  avatarName: string,
  spokenLang: string,
  numExtensions: number
): string[] {
  const templates = [
    // Extension 1: product hero / feature demonstration
    `Seamless continuation of the previous scene. Same creator, same environment, same vibe. ` +
      `Transition to cinematic product beauty shots — extreme close-up of ${productName} showing texture, ` +
      `material quality, and key features in stunning detail. Slow-motion macro lens. Rack-focus from ` +
      `creator's hands holding the product to the product surface. The creator demonstrates one key ` +
      `feature with smooth, natural gestures. Rich warm lighting. No text or overlays. ` +
      `All speech in ${spokenLang}. Perfect lip sync.`,

    // Extension 2: benefit / testimonial moment
    `Continuation. Creator turns back to camera — medium shot — with genuine excitement. ` +
      `Speaks directly to viewer about how ${productName} changed something real for them. ` +
      `Cut between creator's expressive face and product held up clearly. ` +
      `Cinematic handheld motion. A quick cutaway: product placed on a surface, ` +
      `camera tilts up and reveals the full product in a lifestyle setting. ` +
      `Authentic emotion — no scripted feel. All speech in ${spokenLang}. Perfect lip sync.`,

    // Extension 3: CTA + brand close
    `Final segment. ${avatarName} delivers a confident, energetic call to action directly to camera. ` +
      `Holds ${productName} prominently. Camera slowly pushes in to a tight close-up of the product. ` +
      `Last beat: creator smiles warmly at camera, product centred in frame. ` +
      `Soft background bokeh, beautiful lighting. Cinematic close. ` +
      `All speech in ${spokenLang}. Perfect lip sync.`,
  ];

  return templates.slice(0, Math.min(numExtensions, templates.length));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a video via kie.ai.
 *
 * Supported models:
 *   Veo (legacy):   'veo3_fast'  'veo3'
 *   Sora 2:         'sora-2-pro-image-to-video'  'sora-2-pro-text-to-video'
 *   Kling 3.0:      'kling/v3.0'
 *   Kling 2.1 Pro:  'kling/v2-1-pro'
 *   Kling 2.1 Std:  'kling/v2-1-standard'
 *   Wan 2.6:        'wan/2-2-a14b'
 *   (others routed through unified API automatically)
 *
 * imageUrls — reference images to guide generation; pass [] for text-to-video.
 * Returns the generated video as a Buffer.
 */
export async function klingVeoGenerateVideo(
  model: string,
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<Buffer> {
  let videoUrl: string;

  if (LEGACY_VEO_MODELS.has(model)) {
    const taskId = await submitKlingVeoLegacy(model, prompt, imageUrls, apiKey);
    videoUrl = await klingVeoPoll(taskId, apiKey, onProgress);
  } else {
    const taskId = await klingVeoSubmitTask(model, prompt, imageUrls, apiKey);
    videoUrl = await klingVeoPollTask(taskId, apiKey, onProgress);
  }

  return downloadVideo(videoUrl);
}
