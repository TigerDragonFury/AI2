/**
 * Google Gemini API helper — Veo video generation + TTS audio synthesis.
 *
 * Veo 3.1 API: https://ai.google.dev/gemini-api/docs/video
 * TTS API:     https://ai.google.dev/api/generate-content (responseModalities: AUDIO)
 *
 * Set env: GEMINI_API_KEY=<key from Google AI Studio>
 *          AI_PROVIDER=google
 *
 * NOTE: referenceImages in Veo requires the @google/genai SDK — it is NOT
 * available via the raw predictLongRunning REST endpoint.
 */

import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS = 10_000; // 10 s between polls
const MAX_POLLS = 120; // 20 minutes max

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Retry a Google API call up to `maxAttempts` times on 429 rate-limit errors.
 * Uses exponential backoff: 10s, 20s, 40s…
 * Note: this helps with per-minute RPM limits but NOT daily quota exhaustion.
 */
async function retryOn429<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let delay = 10_000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      if (is429 && attempt < maxAttempts) {
        console.warn(
          `[Google] 429 rate limit hit — retrying in ${delay / 1000}s (attempt ${attempt}/${maxAttempts})`
        );
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  /* unreachable */ throw new Error('retryOn429: exhausted');
}

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
 * Voices: Kore, Aoede, Charon, Fenrir, Puck, Orbit, Zephyr, Sulafat, Vindemiatrix...
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
  console.log(`[GeminiTTS] Generated ${pcm.byteLength} bytes PCM - wrapping as WAV`);
  return buildWavBuffer(pcm);
}

// ─── Veo video generation ─────────────────────────────────────────────────────

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
 * Generate a video with Veo 3.1 using the official @google/genai SDK.
 *
 * Supports up to 3 reference images (SDK-only feature -- not available via raw REST).
 * Image order: [0] = person/avatar, [1] = product, [2] = optional 3rd asset.
 *
 * Returns the generated video as a Buffer.
 */
export async function veoGenerateVideo(
  model: string,
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  onProgress?: (pct: number) => void
): Promise<Buffer> {
  const client = new GoogleGenAI({ apiKey });

  // Build reference images in parallel -- skip any that fail to load
  const referenceImages: Array<{
    image: { imageBytes: string; mimeType: string };
    referenceType: VideoGenerationReferenceType;
  }> = [];

  if (imageUrls.length > 0) {
    const results = await Promise.allSettled(
      imageUrls
        .filter(Boolean)
        .slice(0, 3)
        .map((url) => imageUrlToBase64(url))
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        referenceImages.push({
          image: { imageBytes: result.value.data, mimeType: result.value.mimeType },
          referenceType: VideoGenerationReferenceType.ASSET,
        });
      } else {
        console.warn('[Veo] Could not load reference image:', result.reason);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = {
    // reference images require allow_adult; text-only supports allow_all
    personGeneration: referenceImages.length > 0 ? 'allow_adult' : 'allow_all',
    durationSeconds: 8, // required when using reference images
  };
  if (referenceImages.length > 0) config.referenceImages = referenceImages;

  console.log(
    `[Veo] Submitting — model=${model}, refs=${referenceImages.length}, prompt="${prompt.slice(0, 80)}..."`
  );

  // Submit via SDK (handles correct serialization of referenceImages)
  // Retry up to 3 times on transient 429s (per-minute rate limits)
  let operation = await retryOn429(() => client.models.generateVideos({ model, prompt, config }));
  console.log(`[Veo] Operation: ${operation.name}`);

  // Poll until complete using SDK
  for (let i = 0; i < MAX_POLLS && !operation.done; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    operation = await client.operations.getVideosOperation({ operation });
    const pct = Math.floor((i / MAX_POLLS) * 100);
    console.log(`[Veo] Polling... attempt ${i + 1}/${MAX_POLLS} (~${pct}%)`);
    onProgress?.(pct);
  }

  if (!operation.done) {
    throw new Error(`Veo job timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} minutes`);
  }

  const videoFile = operation.response?.generatedVideos?.[0]?.video;
  if (!videoFile) {
    throw new Error(
      `Veo job completed but no video in response: ${JSON.stringify(operation.response).slice(0, 300)}`
    );
  }

  console.log(`[Veo] Complete -- downloading video (uri: ${videoFile.uri ?? 'bytes-inline'})`);

  // Prefer inline bytes, fall back to URI download
  if (videoFile.videoBytes) {
    return Buffer.from(videoFile.videoBytes, 'base64');
  } else if (videoFile.uri) {
    const dlRes = await fetch(videoFile.uri, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(120_000),
    });
    if (!dlRes.ok) throw new Error(`Veo video download error ${dlRes.status}`);
    return Buffer.from(await dlRes.arrayBuffer());
  } else {
    throw new Error('Veo video has neither uri nor videoBytes in response');
  }
}
