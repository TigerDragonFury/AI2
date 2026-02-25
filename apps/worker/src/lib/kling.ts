/**
 * Kie.ai Veo 3.1 API helper — video generation.
 *
 * API docs: https://docs.kie.ai/veo3-api/generate-veo-3-video
 *
 * Set env: KLING_API_KEY=<key from kie.ai/api-key>
 *          AI_PROVIDER=kling
 *
 * Advantages over Google direct API:
 *   - No daily quota limits (credit-based, pay-per-use)
 *   - REFERENCE_2_VIDEO mode — up to 3 reference images to preserve appearance
 *   - Native Veo 3.1 audio generation in the video (no separate TTS needed)
 *   - 25% of Google's direct API pricing
 */

const KLING_BASE = 'https://api.kie.ai';
const POLL_INTERVAL_MS = 5_000; // 5 s between polls
const MAX_POLLS = 144; // 12 minutes max

// successFlag values from API
const STATUS_GENERATING = 0;
const STATUS_SUCCESS = 1;
const STATUS_FAILED = 2;
const STATUS_GENERATION_FAILED = 3;

interface KlingSubmitResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}

interface KlingPollResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    successFlag: number;
    errorMessage?: string;
    response?: {
      resultUrls?: string[];
      originUrls?: string[];
      resolution?: string;
    };
  };
}

/**
 * Generate a video with Veo 3.1 via kie.ai.
 *
 * Generation mode selection (automatic):
 *   - 1–3 images + veo3_fast model → REFERENCE_2_VIDEO (preserves subject/product appearance)
 *   - 1–2 images + veo3 model     → FIRST_AND_LAST_FRAMES_2_VIDEO (image-to-video)
 *   - 0 images                    → TEXT_2_VIDEO
 *
 * Veo 3.1 natively generates synchronized audio from the prompt — no separate TTS needed.
 * Include dialogue lines directly in the prompt using quotes for best results.
 *
 * Returns the generated video as a Buffer.
 */
export async function klingVeoGenerateVideo(
  model: string, // 'veo3' or 'veo3_fast'
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<Buffer> {
  const validUrls = imageUrls.filter(Boolean).slice(0, 3);

  // Determine generation type and effective model
  let generationType: string;
  const effectiveModel = model;
  let submittedUrls: string[] = validUrls;

  if (validUrls.length > 0) {
    // REFERENCE_2_VIDEO: best for preserving person + product appearance
    // Constraints: veo3_fast only, 16:9 only, 1–3 images
    if (effectiveModel === 'veo3_fast') {
      generationType = 'REFERENCE_2_VIDEO';
    } else {
      // veo3 (quality): use first image as starting frame
      generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
      submittedUrls = validUrls.slice(0, 2);
    }
  } else {
    generationType = 'TEXT_2_VIDEO';
    submittedUrls = [];
  }

  console.log(
    `[Kling] Submitting — model=${effectiveModel}, mode=${generationType}, ` +
      `refs=${submittedUrls.length}, prompt="${prompt.slice(0, 80)}..."`
  );

  const submitRes = await fetch(`${KLING_BASE}/api/v1/veo/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      ...(submittedUrls.length > 0 && { imageUrls: submittedUrls }),
      model: effectiveModel,
      generationType,
      aspect_ratio: '16:9',
      enableTranslation: false, // prompt is already in English from our LLM
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const txt = await submitRes.text();
    throw new Error(`Kling Veo submit error ${submitRes.status}: ${txt}`);
  }

  const submitJson = (await submitRes.json()) as KlingSubmitResponse;
  if (submitJson.code !== 200 || !submitJson.data?.taskId) {
    throw new Error(`Kling Veo submit failed (code ${submitJson.code}): ${submitJson.msg}`);
  }

  const { taskId } = submitJson.data;
  console.log(`[Kling] Task submitted: ${taskId}`);

  // Poll until complete
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${KLING_BASE}/api/v1/veo/record-info?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pollRes.ok) {
      const txt = await pollRes.text();
      throw new Error(`Kling Veo poll error ${pollRes.status}: ${txt}`);
    }

    const pollJson = (await pollRes.json()) as KlingPollResponse;
    const d = pollJson.data;

    if (!d) {
      throw new Error(`Kling poll returned no data: ${JSON.stringify(pollJson)}`);
    }

    if (d.successFlag === STATUS_FAILED || d.successFlag === STATUS_GENERATION_FAILED) {
      throw new Error(`Kling Veo generation failed: ${d.errorMessage ?? 'unknown error'}`);
    }

    if (d.successFlag === STATUS_SUCCESS) {
      const videoUrl = d.response?.resultUrls?.[0];
      if (!videoUrl) {
        throw new Error(
          `Kling job done but no video URL in response: ${JSON.stringify(d.response)}`
        );
      }

      console.log(
        `[Kling] Job complete (${d.response?.resolution ?? 'unknown res'}) — downloading video...`
      );
      const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
      if (!dlRes.ok) throw new Error(`Kling video download error ${dlRes.status}`);
      return Buffer.from(await dlRes.arrayBuffer());
    }

    if (d.successFlag !== STATUS_GENERATING) {
      throw new Error(`Kling unexpected successFlag: ${d.successFlag}`);
    }

    const pct = Math.floor((i / MAX_POLLS) * 100);
    console.log(`[Kling] Polling... attempt ${i + 1}/${MAX_POLLS} (~${pct}%)`);
    onProgress?.(pct);
  }

  throw new Error(
    `Kling Veo job timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} minutes`
  );
}
