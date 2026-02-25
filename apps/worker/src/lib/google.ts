/**
 * Google Veo video generation helper.
 * Uses the Gemini API predictLongRunning endpoint.
 *
 * API reference: https://ai.google.dev/api/generate-video
 * Veo 3.1 accepts up to 3 reference images to preserve subject appearance.
 *
 * Set env: GEMINI_API_KEY=<key from Google AI Studio or Vertex AI>
 *          AI_PROVIDER=google
 */

const VEO_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS = 10_000; // 10 s between polls
const MAX_POLLS = 120; // 20 minutes max

interface VeoReferenceImage {
  image: { inlineData: { mimeType: string; data: string } };
  referenceType: 'asset';
}

/** Fetch an image URL and return base64 + mimeType. */
async function imageUrlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to fetch reference image (${res.status}): ${url}`);
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const mimeType = contentType.split(';')[0]?.trim() ?? 'image/jpeg';
  const buffer = await res.arrayBuffer();
  return { data: Buffer.from(buffer).toString('base64'), mimeType };
}

/**
 * Submit a Veo video generation job with up to 3 reference images.
 *
 * Image order matters for Veo:
 *   [0] = person / avatar  (preserves the subject's appearance)
 *   [1] = product          (preserves the product's appearance)
 *   [2] = optional 3rd asset
 *
 * Returns the operation name for polling.
 */
export async function veoSubmitJob(
  model: string,
  prompt: string,
  imageUrls: string[],
  apiKey: string
): Promise<string> {
  // Fetch all reference images in parallel — skip any that fail to load
  const refs: VeoReferenceImage[] = [];
  const results = await Promise.allSettled(
    imageUrls
      .filter(Boolean)
      .slice(0, 3)
      .map((url) => imageUrlToBase64(url))
  );
  for (const result of results) {
    if (result.status === 'fulfilled') {
      refs.push({
        image: { inlineData: { mimeType: result.value.mimeType, data: result.value.data } },
        referenceType: 'asset',
      });
    } else {
      console.warn('[Veo] Could not load reference image:', result.reason);
    }
  }

  const parameters: Record<string, unknown> = {};
  if (refs.length > 0) parameters.referenceImages = refs;

  const body = {
    instances: [{ prompt }],
    parameters,
  };

  console.log(
    `[Veo] Submitting job — model=${model}, refs=${refs.length}, prompt="${prompt.slice(0, 80)}..."`
  );

  const res = await fetch(`${VEO_BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Veo submit error ${res.status}: ${txt}`);
  }

  const json = (await res.json()) as { name?: string };
  if (!json.name) {
    throw new Error(`Veo API returned no operation name: ${JSON.stringify(json)}`);
  }
  console.log(`[Veo] Operation submitted: ${json.name}`);
  return json.name;
}

/**
 * Poll a Veo long-running operation until it completes.
 * Returns the signed video URI (requires API key to download).
 */
export async function veoPollJob(
  operationName: string,
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${VEO_BASE}/${operationName}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Veo poll error ${res.status}: ${txt}`);
    }

    const status = (await res.json()) as {
      done?: boolean;
      error?: { message?: string; code?: number };
      response?: {
        generateVideoResponse?: {
          generatedSamples?: Array<{ video?: { uri?: string } }>;
        };
      };
    };

    if (status.error) {
      throw new Error(`Veo job failed: ${status.error.message ?? JSON.stringify(status.error)}`);
    }

    if (status.done) {
      const uri = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        throw new Error(
          `Veo job completed but no video URI in response: ${JSON.stringify(status)}`
        );
      }
      console.log(`[Veo] Job complete — video URI obtained`);
      return uri;
    }

    const pct = Math.floor((i / MAX_POLLS) * 100);
    console.log(`[Veo] Polling... attempt ${i + 1}/${MAX_POLLS} (~${pct}%)`);
    onProgress?.(pct);
  }

  throw new Error(`Veo job timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} minutes`);
}

/**
 * Download a Veo video from its signed URI.
 * The URI requires the same API key that generated it.
 */
export async function veoDownloadVideo(uri: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(uri, {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(120_000),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redirect: 'follow' as any,
  });
  if (!res.ok) throw new Error(`Veo video download error ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
