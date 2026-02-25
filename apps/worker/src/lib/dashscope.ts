/**
 * Alibaba Cloud DashScope video generation helper.
 * International endpoint: https://dashscope-intl.aliyuncs.com
 *
 * Free quota: 90 days for new Model Studio users (Singapore region)
 * https://www.alibabacloud.com/help/en/model-studio/new-free-quota
 *
 * Set env: ALIBABA_API_KEY=<key from Singapore console>
 *          AI_PROVIDER=dashscope
 */

const DASHSCOPE_BASE = 'https://dashscope-intl.aliyuncs.com';

interface DashScopeTaskResponse {
  output: {
    task_id: string;
    task_status: string;
  };
  request_id: string;
}

interface DashScopeTaskStatus {
  output: {
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
    video_url?: string;
    submit_time?: string;
    scheduled_time?: string;
    end_time?: string;
  };
  usage?: { video_duration?: number; video_ratio?: string };
  request_id: string;
}

export async function dashscopeSubmitVideoTask(
  model: string,
  input: Record<string, unknown>,
  parameters: Record<string, unknown>,
  apiKey: string
): Promise<string> {
  const res = await fetch(
    `${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({ model, input, parameters }),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DashScope submit error ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as DashScopeTaskResponse;
  const taskId = data?.output?.task_id;
  if (!taskId) throw new Error(`DashScope returned no task_id: ${JSON.stringify(data)}`);

  return taskId;
}

export async function dashscopePollVideoTask(
  taskId: string,
  apiKey: string,
  onProgress?: (percent: number) => void,
  maxWaitMs = 600_000 // 10 min
): Promise<string> {
  const POLL_INTERVAL = 5000;
  const maxAttempts = Math.ceil(maxWaitMs / POLL_INTERVAL);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));

    const res = await fetch(`${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`DashScope poll error ${res.status}: ${txt}`);
    }

    const data = (await res.json()) as DashScopeTaskStatus;
    const status = data?.output?.task_status;

    if (status === 'SUCCEEDED') {
      const videoUrl = data?.output?.video_url;
      if (!videoUrl)
        throw new Error(`DashScope task succeeded but no video_url: ${JSON.stringify(data)}`);
      return videoUrl;
    }

    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`DashScope task ${status}: ${JSON.stringify(data.output)}`);
    }

    // PENDING or RUNNING — keep polling
    if (onProgress) onProgress(Math.floor((i / maxAttempts) * 100));
  }

  throw new Error(`DashScope task ${taskId} timed out after ${maxWaitMs / 1000}s`);
}

// ─── Image editing (wan2.5-i2i-preview) ──────────────────────────────────────

interface DashScopeImageTaskStatus {
  output: {
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
    results?: { url: string; orig_prompt?: string; actual_prompt?: string }[];
  };
  request_id: string;
}

/**
 * Submit a Wan2.5 image editing task (supports multi-image fusion).
 * Endpoint: POST /api/v1/services/aigc/image2image/image-synthesis
 *
 * @param model  e.g. "wan2.5-i2i-preview"
 * @param images Array of image URLs (up to 3). For multi-image fusion: [avatarUrl, productUrl]
 * @param prompt Editing instructions, e.g. "Person from Image 1 holds the product from Image 2"
 * @param size   Output resolution "width*height", e.g. "720*1280" (total pixels ≤ 1,638,400)
 * @param apiKey DashScope API key
 */
export async function dashscopeSubmitImageEditTask(
  model: string,
  images: string[],
  prompt: string,
  size: string,
  apiKey: string
): Promise<string> {
  const res = await fetch(`${DASHSCOPE_BASE}/api/v1/services/aigc/image2image/image-synthesis`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model,
      input: { prompt, images },
      parameters: { size, prompt_extend: true, watermark: false, n: 1 },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DashScope image-edit submit error ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as DashScopeTaskResponse;
  const taskId = data?.output?.task_id;
  if (!taskId) throw new Error(`DashScope image-edit returned no task_id: ${JSON.stringify(data)}`);

  return taskId;
}

/**
 * Poll a Wan2.5 image editing task until complete; returns the generated image URL.
 * Uses the same /api/v1/tasks/{task_id} endpoint as video tasks.
 */
export async function dashscopePollImageTask(
  taskId: string,
  apiKey: string,
  maxWaitMs = 180_000 // 3 min — image gen is faster than video
): Promise<string> {
  const POLL_INTERVAL = 5000;
  const maxAttempts = Math.ceil(maxWaitMs / POLL_INTERVAL);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));

    const res = await fetch(`${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`DashScope image poll error ${res.status}: ${txt}`);
    }

    const data = (await res.json()) as DashScopeImageTaskStatus;
    const status = data?.output?.task_status;

    if (status === 'SUCCEEDED') {
      const imageUrl = data?.output?.results?.[0]?.url;
      if (!imageUrl)
        throw new Error(`DashScope image task succeeded but no url: ${JSON.stringify(data)}`);
      return imageUrl;
    }

    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`DashScope image task ${status}: ${JSON.stringify(data.output)}`);
    }
  }

  throw new Error(`DashScope image task ${taskId} timed out after ${maxWaitMs / 1000}s`);
}

// ─── CosyVoice TTS ────────────────────────────────────────────────────────────

/**
 * Generate speech audio from text using DashScope CosyVoice TTS.
 * Returns the raw audio as a Buffer (MP3 format).
 *
 * The API streams audio via Server-Sent Events; each event carries a
 * base64-encoded audio chunk. We collect all chunks and concatenate them.
 *
 * @param text    The dialogue/script to synthesise (max ~500 characters recommended)
 * @param voice   Voice ID, e.g. "longxiaochun" (multilingual, default)
 * @param model   TTS model, e.g. "cosyvoice-v3-plus"
 * @param apiKey  DashScope API key
 */
/**
 * Generate speech using Qwen TTS Realtime (OpenAI-realtime-compatible WebSocket).
 * Returns a WAV buffer (PCM 16-bit 24 kHz mono) ready for Cloudinary upload.
 *
 * Protocol:
 *   1. Connect  wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model={model}
 *   2. Receive  session.created
 *   3. Send     session.update  { voice, output_audio_format: "pcm16" }
 *   4. Send     conversation.item.create  { role:user, content:[{type:input_text,text}] }
 *   5. Send     response.create
 *   6. Collect  response.audio.delta  (base64 PCM16 chunks)
 *   7. Resolve  on response.done  → wrap chunks in WAV header
 */
/** Map BCP-47 language codes to Qwen3-TTS language_type strings. */
// Supported language_type values per Qwen3-TTS-Flash docs.
// Arabic is not supported — falls back to 'Auto'.
const LANG_TYPE: Record<string, string> = {
  en: 'English',
  zh: 'Chinese',
  es: 'Spanish',
  de: 'German',
  ja: 'Japanese',
  it: 'Italian',
  pt: 'Portuguese',
  fr: 'French',
  ko: 'Korean',
  ru: 'Russian',
  ar: 'Auto',
};

/**
 * Generate speech using the Qwen3-TTS-Flash REST API.
 * Returns the raw WAV buffer fetched from the signed OSS URL in the response.
 *
 * POST https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 * { model, input: { text, voice, language_type } }
 * → output.audio.url  (signed WAV file)
 */
export async function dashscopeTextToSpeech(
  text: string,
  voice: string,
  model: string,
  apiKey: string,
  language = 'en'
): Promise<Buffer> {
  const language_type = LANG_TYPE[language] ?? 'Auto';

  const res = await fetch(
    `${DASHSCOPE_BASE}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: { text, voice, language_type },
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  const json = (await res.json()) as {
    status_code?: number;
    code?: string;
    message?: string;
    output?: { audio?: { url?: string; data?: string } };
  };

  if (!res.ok || json.code) {
    throw new Error(
      `Qwen TTS error ${json.status_code ?? res.status}: ${json.message ?? JSON.stringify(json)}`
    );
  }

  const audioUrl = json.output?.audio?.url;
  const audioData = json.output?.audio?.data;

  // Prefer the signed OSS URL; fall back to inline base64 data
  if (audioUrl) {
    const wavRes = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
    if (!wavRes.ok) throw new Error(`Failed to fetch TTS audio: ${wavRes.status}`);
    return Buffer.from(await wavRes.arrayBuffer());
  }

  if (audioData) {
    return Buffer.from(audioData, 'base64');
  }

  throw new Error('Qwen TTS returned no audio URL or data');
}

// ─── Qwen dialogue auto-generation ───────────────────────────────────────────

interface QwenChatResponse {
  output: {
    choices: { message: { content: string } }[];
  };
  usage?: { total_tokens?: number };
}

/**
 * Brand/company context fed into the dialogue script generation.
 * All fields are optional — the prompt degrades gracefully if missing.
 */
export interface DialogueContext {
  /** Company or brand name, e.g. "AlSaraya Butchery" */
  companyName?: string;
  /** Combined brand voice string, e.g. "luxury, elegant" or "casual, friendly" */
  brandVoice?: string;
  /** Pre-formatted price string, e.g. "89 AED" or "12.99 USD" */
  price?: string;
  /** Short product description for additional context */
  productDescription?: string;
}

/**
 * Auto-generate a short ad dialogue/voiceover script using Qwen LLM.
 * Returns plain text — the voiceover lines the avatar should speak.
 *
 * @param productName Product the ad is about
 * @param avatarName  Name of the talent/creator in the ad
 * @param userPrompt  User's scene description
 * @param language    ISO language code: "en", "ar", "fr", etc.
 * @param duration    Video duration in seconds (for pacing)
 * @param model       Qwen model ID
 * @param apiKey      DashScope API key
 * @param ctx         Optional brand/company context
 */
export async function dashscopeGenerateDialogue(
  productName: string,
  avatarName: string,
  userPrompt: string,
  language: string,
  duration: number,
  model: string,
  apiKey: string,
  ctx?: DialogueContext
): Promise<string> {
  const wordLimit = duration <= 3 ? 15 : duration <= 5 ? 25 : 40;
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

  // Build optional brand context lines for the system + user prompts
  const brandTone = ctx?.brandVoice
    ? `Brand tone / voice: ${ctx.brandVoice}. Match this tone throughout.`
    : '';
  const brandName = ctx?.companyName ? `Brand name: "${ctx.companyName}". ` : '';
  const priceInstruction = ctx?.price
    ? `(6) The product costs ${ctx.price} — work this price into the CTA naturally (e.g. "Only ${ctx.price}!"). `
    : '';
  const productDescLine = ctx?.productDescription
    ? `Product details: ${ctx.productDescription}. `
    : '';

  const systemPrompt =
    `You are a professional paid-ad copywriter specialising in short UGC video ads. ` +
    `You MUST write ONLY in ${langName} — every single word of your response must be in ${langName}. ` +
    `Your sole goal is to make viewers want to PURCHASE the product being advertised. ` +
    `Always highlight a concrete benefit or quality of the product (taste, freshness, value, uniqueness, etc.) ` +
    `and end with an implicit or explicit call to action (try it, order now, get yours, don't miss out, etc.). ` +
    `NEVER narrate what the person is cooking or doing — speak TO the viewer ABOUT the product. ` +
    `Be punchy, energetic, and persuasive. ` +
    (brandTone ? brandTone + ' ' : '') +
    `Output ONLY the spoken words in ${langName} — no stage directions, no speaker labels, no quotation marks, no English.`;

  const userMessage =
    `Write a ${duration}-second PRODUCT AD voiceover IN ${langName.toUpperCase()} ONLY. ` +
    `Product: "${productName}". ` +
    brandName +
    productDescLine +
    `Speaker: ${avatarName || 'an influencer'} is showing off the product on camera. ` +
    `Context: ${userPrompt}. ` +
    `Rules: ` +
    `(1) Sell the product — highlight WHY it is worth buying (quality, flavour, freshness, value, etc.). ` +
    `(2) Address the viewer directly ("you", "try", "order", "get yours"). ` +
    `(3) End with a call to action. ` +
    `(4) Do NOT say "I cooked" / "I made" / "I love how these turned out" — that is narration, not advertising. ` +
    `(5) Keep it under ${wordLimit} words. ` +
    priceInstruction +
    `IMPORTANT: Your entire response must be written in ${langName} script only — do NOT use English.`;

  const res = await fetch(`${DASHSCOPE_BASE}/api/v1/services/aigc/text-generation/generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      },
      parameters: { result_format: 'message', max_tokens: 120 },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DashScope Qwen error ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as QwenChatResponse;
  const dialogue = data?.output?.choices?.[0]?.message?.content?.trim();
  if (!dialogue) throw new Error(`Qwen returned no dialogue: ${JSON.stringify(data)}`);
  return dialogue;
}

// ─── Qwen VL product image analysis ─────────────────────────────────────────

interface QwenVLResponse {
  output: {
    choices: { message: { content: { text?: string }[] | string } }[];
  };
}

/**
 * Use Qwen VL to scan the product image and auto-generate a UGC ad scene description.
 * Returns a short rawPrompt the worker can use as-is (or pass through enhanceAdPrompt).
 *
 * @param productImageUrl  Publicly accessible URL of the product image
 * @param productName      Product name for context
 * @param avatarName       Creator/talent name for context
 * @param duration         Video duration in seconds (for pacing guidance)
 * @param model            Qwen VL model ID, e.g. "qwen-vl-plus"
 * @param apiKey           DashScope API key
 * @param ctx              Optional brand/company context
 */
export async function dashscopeAnalyzeProductImage(
  productImageUrl: string,
  productName: string,
  avatarName: string,
  duration: number,
  model: string,
  apiKey: string,
  ctx?: DialogueContext
): Promise<string> {
  const brandToneHint = ctx?.brandVoice
    ? ` The brand tone is: ${ctx.brandVoice}. Let this influence the mood and energy of the scene description.`
    : '';
  const productDetailHint = ctx?.productDescription
    ? ` Additional product detail: ${ctx.productDescription}.`
    : '';

  const instruction =
    `You are an expert UGC ad director. Study this product image carefully. ` +
    `Write a single vivid scene description (1-2 sentences, max 180 characters) for a ${duration}-second UGC video ad. ` +
    `The creator named "${avatarName || 'the creator'}" is showcasing "${productName}". ` +
    `Describe: what action the creator is performing with the product, their expression, and the mood. ` +
    `Start with an action verb. Be specific about the product based on what you see in the image.` +
    brandToneHint +
    productDetailHint +
    ` Output ONLY the scene description — no titles, no explanations.`;

  const res = await fetch(
    `${DASHSCOPE_BASE}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: 'user',
              content: [{ image: productImageUrl }, { text: instruction }],
            },
          ],
        },
        parameters: { result_format: 'message', max_tokens: 120 },
      }),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DashScope Qwen VL error ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as QwenVLResponse;
  const choice = data?.output?.choices?.[0]?.message?.content;
  let text: string;
  if (Array.isArray(choice)) {
    text = choice
      .map((c) => c.text ?? '')
      .join('')
      .trim();
  } else {
    text = (choice as string)?.trim() ?? '';
  }
  if (!text) throw new Error(`Qwen VL returned no description: ${JSON.stringify(data)}`);
  return text;
}
