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
