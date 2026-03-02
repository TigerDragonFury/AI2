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
const MAX_POLLS = 240; // 20 minutes max (sora-2-pro can take 15–18 min)

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

  // ── Sora 2 models ──────────────────────────────────────────────────────────
  if (model === SORA2_I2V_MODEL || (model === SORA2_T2V_MODEL && hasImages)) {
    // Auto-upgrade T2V to I2V when images are available
    return {
      prompt,
      image_urls: validUrls.slice(0, 3),
      aspect_ratio: 'landscape',
      n_frames: durStr,
      size: 'standard',
      remove_watermark: true,
    };
  }
  if (model === SORA2_T2V_MODEL) {
    return {
      prompt,
      aspect_ratio: 'landscape',
      n_frames: durStr,
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
  const wordLimit = durationSec <= 3 ? 15 : durationSec <= 5 ? 25 : 40;
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
    `You are a professional paid-ad copywriter specialising in short UGC video ads. ` +
    `You MUST write ONLY in ${langName} — every single word of your response must be in ${langName}. ` +
    `Your sole goal is to make viewers want to PURCHASE the product being advertised. ` +
    `Always highlight a concrete benefit or quality of the product and end with a call to action. ` +
    `NEVER narrate what the person is doing — speak TO the viewer ABOUT the product. ` +
    `Be punchy, energetic, and persuasive. ${brandTone}`;

  const userPrompt =
    `${brandName}${productDescLine}${priceInstruction}` +
    `Write a ${wordLimit}-word max spoken dialogue script in ${langName} for a ${durationSec}-second ` +
    `UGC video ad for the product "${productName}" presented by ${avatarName}. ` +
    `Context: ${sceneDescription}. ` +
    `Output ONLY the dialogue text — no stage directions, no labels, no quotes.`;

  const res = await fetch(`${KLING_BASE}/${model}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      include_thoughts: false,
    }),
    signal: AbortSignal.timeout(90_000), // 90s — matches vision; Arabic/non-Latin is slower
  });

  if (!res.ok)
    throw new Error(`Kie.ai dialogue generation error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as KieChatResponse;
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

  const res = await fetch(`${KLING_BASE}/${model}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
      include_thoughts: false, // disable thinking tokens so content is a plain string
    }),
    signal: AbortSignal.timeout(90_000), // 90s — vision calls are slower than text-only
  });

  if (!res.ok) throw new Error(`Kie.ai vision error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as KieChatResponse;
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
  apiKey: string
): Promise<string> {
  const t1 = Math.round(durationSec * 0.25);
  const t2 = Math.round(durationSec * 0.5);
  const t3 = Math.round(durationSec * 0.75);

  const systemInstruction =
    `You are an expert film director and UGC video ad specialist. ` +
    `Transform the provided scene description into a single cohesive video generation prompt ` +
    `structured as a cinematic timeline. The output must be plain text — NO markdown, NO bullet ` +
    `list symbols, NO headers. Write it as a single block a video model can parse directly.\n\n` +
    `Required structure (fill in the brackets — do NOT include the bracket labels in output):\n` +
    `[VIBE: energetic/luxury/playful/warm/authoritative] [FORMAT: portrait 9:16] ` +
    `[GENRE: UGC creator-style cinematic ad] — ` +
    `[0–${t1}s hook: opening action + camera motion + lighting mood] — ` +
    `[${t1}–${t2}s context: creator introduces or interacts with product] — ` +
    `[${t2}–${t3}s climax: key benefit close-up, product hero shot, emotion peak] — ` +
    `[${t3}–${durationSec}s resolution: authentic reaction, soft CTA or brand close] — ` +
    `[scene narrative: 1–2 sentence total description tying everything together]`;

  const userContent =
    `Product: ${productName}\n` +
    `Creator/Avatar: ${avatarName}\n` +
    (brandVoice ? `Brand voice: ${brandVoice}\n` : '') +
    `Duration: ${durationSec} seconds\n` +
    `Scene description: ${sceneDescription}\n\n` +
    `Write the cinematic timeline prompt now.`;

  const res = await fetch(`${KLING_BASE}/${model}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
      stream: false,
      include_thoughts: false, // disable thinking tokens so content is a plain string
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(`Kie.ai cinematic prompt error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as KieChatResponse;
  const text = extractKieText(json);
  if (!text) {
    console.error('[Kie.ai Cinematic] Raw response:', JSON.stringify(json).slice(0, 1000));
    throw new Error('Kie.ai cinematic prompt returned no text');
  }
  console.log(`[Kie.ai Cinematic] Generated timeline prompt (${text.length} chars)`);
  return text;
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
