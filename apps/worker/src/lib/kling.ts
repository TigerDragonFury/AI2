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

const KLING_BASE = 'https://api.kie.ai';
const POLL_INTERVAL_MS = 5_000; // 5 s between polls
const MAX_POLLS = 144; // 12 minutes max

// Models that still use the legacy Veo endpoint
const LEGACY_VEO_MODELS = new Set(['veo3', 'veo3_fast']);

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

// ─── Legacy Veo path ─────────────────────────────────────────────────────────

async function klingVeoPoll(
  taskId: string,
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${KLING_BASE}/api/v1/veo/record-info?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
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

async function submitKlingVeoLegacy(
  model: string,
  prompt: string,
  imageUrls: string[],
  apiKey: string
): Promise<string> {
  const validUrls = imageUrls.filter(Boolean).slice(0, 3);
  let generationType: string;
  let submittedUrls = validUrls;

  if (validUrls.length > 0) {
    if (model === 'veo3_fast') {
      generationType = 'REFERENCE_2_VIDEO'; // up to 3 reference images
    } else {
      generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
      submittedUrls = validUrls.slice(0, 2);
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
      prompt,
      ...(submittedUrls.length > 0 && { imageUrls: submittedUrls }),
      model,
      generationType,
      aspect_ratio: '16:9',
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

// ─── Unified API path ────────────────────────────────────────────────────────

async function unifiedPoll(
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
  imageUrls: string[]
): Record<string, unknown> {
  const validUrls = imageUrls.filter(Boolean);
  const hasImages = validUrls.length > 0;

  // ── Sora 2 models ──────────────────────────────────────────────────────────
  if (model === SORA2_I2V_MODEL || (model === SORA2_T2V_MODEL && hasImages)) {
    // Auto-upgrade T2V to I2V when images are available
    return {
      prompt,
      image_urls: validUrls.slice(0, 3),
      aspect_ratio: 'landscape',
      n_frames: '10',
      size: 'standard',
      remove_watermark: true,
    };
  }
  if (model === SORA2_T2V_MODEL) {
    return {
      prompt,
      aspect_ratio: 'landscape',
      n_frames: '10',
      size: 'standard',
      remove_watermark: true,
    };
  }

  // ── Kling models (v3.0, v2-1-pro, v2-1-standard, etc.) ───────────────────
  if (model.startsWith('kling/')) {
    if (hasImages) {
      return {
        prompt,
        image_url: validUrls[0], // Kling I2V takes a single image
        duration: '5',
        negative_prompt: '',
        cfg_scale: 0.5,
      };
    }
    return { prompt, duration: '5', negative_prompt: '', aspect_ratio: '16:9', cfg_scale: 0.5 };
  }

  // ── Wan model ─────────────────────────────────────────────────────────────
  if (model.startsWith('wan/')) {
    return hasImages
      ? { prompt, image_url: validUrls[0], duration: '5' }
      : { prompt, aspect_ratio: '16:9', duration: '5' };
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  return hasImages ? { prompt, image_url: validUrls[0] } : { prompt };
}

async function submitUnified(
  model: string,
  prompt: string,
  imageUrls: string[],
  apiKey: string
): Promise<string> {
  const input = buildUnifiedInput(model, prompt, imageUrls);
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
    const taskId = await submitUnified(model, prompt, imageUrls, apiKey);
    videoUrl = await unifiedPoll(taskId, apiKey, onProgress);
  }

  return downloadVideo(videoUrl);
}
