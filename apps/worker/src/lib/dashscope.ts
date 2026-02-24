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
 * @param model   TTS model, e.g. "cosyvoice-v3-flash"
 * @param apiKey  DashScope API key
 */
export async function dashscopeTextToSpeech(
  text: string,
  voice: string,
  model: string,
  apiKey: string
): Promise<Buffer> {
  const res = await fetch(`${DASHSCOPE_BASE}/api/v1/services/aigc/text2audio/synthesis`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'enable',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      input: { text },
      parameters: { voice, format: 'mp3', sample_rate: 22050 },
    }),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text();
    throw new Error(`DashScope TTS error ${res.status}: ${txt}`);
  }

  const audioChunks: Buffer[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let streamFinished = false;

  while (!streamFinished) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) {
      streamFinished = true;
      break;
    }

    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const evt = JSON.parse(raw) as { output?: { audio?: string; finish_reason?: string } };
        const b64 = evt?.output?.audio;
        if (b64) audioChunks.push(Buffer.from(b64, 'base64'));
      } catch {
        // skip malformed events
      }
    }
  }

  if (audioChunks.length === 0) {
    throw new Error('DashScope TTS returned no audio data');
  }

  return Buffer.concat(audioChunks);
}

// ─── Qwen dialogue auto-generation ───────────────────────────────────────────

interface QwenChatResponse {
  output: {
    choices: { message: { content: string } }[];
  };
  usage?: { total_tokens?: number };
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
 */
export async function dashscopeGenerateDialogue(
  productName: string,
  avatarName: string,
  userPrompt: string,
  language: string,
  duration: number,
  model: string,
  apiKey: string
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

  const systemPrompt =
    `You are a professional UGC ad scriptwriter. ` +
    `You MUST write ONLY in ${langName} — every single word of your response must be in ${langName}. ` +
    `Write natural, enthusiastic voiceover lines for a short video ad. ` +
    `Be concise, conversational, and persuasive. ` +
    `Output ONLY the spoken dialogue in ${langName} — no stage directions, no speaker labels, no quotation marks, no English.`;

  const userMessage =
    `Write a ${duration}-second ad voiceover IN ${langName.toUpperCase()} ONLY for "${productName}". ` +
    `The speaker is ${avatarName || 'an influencer'}. ` +
    `Scene: ${userPrompt}. ` +
    `Keep it under ${wordLimit} words. ` +
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
 */
export async function dashscopeAnalyzeProductImage(
  productImageUrl: string,
  productName: string,
  avatarName: string,
  duration: number,
  model: string,
  apiKey: string
): Promise<string> {
  const instruction =
    `You are an expert UGC ad director. Study this product image carefully. ` +
    `Write a single vivid scene description (1-2 sentences, max 180 characters) for a ${duration}-second UGC video ad. ` +
    `The creator named "${avatarName || 'the creator'}" is showcasing "${productName}". ` +
    `Describe: what action the creator is performing with the product, their expression, and the mood. ` +
    `Start with an action verb. Be specific about the product based on what you see in the image. ` +
    `Output ONLY the scene description — no titles, no explanations.`;

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
