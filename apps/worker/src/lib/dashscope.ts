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
