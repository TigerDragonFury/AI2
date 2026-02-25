/**
 * Google Gemini API helper — Veo video generation + TTS audio synthesis.
 *
 * Veo 3.1 API: https://ai.google.dev/api/generate-video
 * TTS API:     https://ai.google.dev/api/generate-content (responseModalities: AUDIO)
 *
 * Set env: GEMINI_API_KEY=<key from Google AI Studio or Vertex AI>
 *          AI_PROVIDER=google
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS = 10_000; // 10 s between polls
const MAX_POLLS = 120; // 20 minutes max

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Build a 44-byte WAV header around raw PCM16 mono audio. */
function buildWavBuffer(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2; // mono 16-bit
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

/**
 * Generate speech using Gemini 2.5 Flash TTS.
 * Returns a WAV buffer (PCM16 24 kHz mono) ready for Cloudinary upload.
 *
 * Voices: Kore, Aoede, Charon, Fenrir, Puck, Orbit, Zephyr, Sulafat, Vindemiatrix…
 * Any language is supported automatically by the model.
 */
export async function geminiTextToSpeech(
  text: string,
  voice: string,
  model: string,
  apiKey: string
): Promise<Buffer> {
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini TTS error ${res.status}: ${txt}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  };

  const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) {
    throw new Error(`Gemini TTS returned no audio data: ${JSON.stringify(json).slice(0, 200)}`);
  }

  const pcm = Buffer.from(b64, 'base64');
  console.log(`[GeminiTTS] Generated ${pcm.byteLength} bytes PCM → wrapping as WAV`);
  return buildWavBuffer(pcm);
}

// ─── Veo video generation ─────────────────────────────────────────────────────

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

  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
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

    const res = await fetch(`${GEMINI_BASE}/${operationName}`, {
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
