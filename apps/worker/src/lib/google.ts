/**
 * Google Gemini API helper — Veo video generation + TTS audio synthesis +
 * cinematic timeline prompt generation + Google Drive backup upload.
 *
 * Veo 3.1 API:     https://ai.google.dev/gemini-api/docs/video
 * TTS API:         https://ai.google.dev/api/generate-content (responseModalities: AUDIO)
 * Drive REST API:  https://developers.google.com/drive/api/v3/reference/files/create
 *
 * Set env: GEMINI_API_KEY=<key from Google AI Studio>
 *          AI_PROVIDER=google   (or "kling" for Kie.ai)
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

// ─── Cinematic Timeline Prompt ────────────────────────────────────────────────

/**
 * Use Gemini Flash to expand a raw scene description into a structured
 * cinematic timeline script (Hollywood-style director's brief) optimised for
 * Veo 3.1 / Kie.ai Veo video generation.
 *
 * The output is a drop-in replacement for `enhancedPrompt` — it includes the
 * original scene intent PLUS temporal cues, camera motion, lighting, and
 * dialogue placement that Veo uses for higher-quality output.
 */
export async function geminiCinematicPrompt(
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

  const systemPrompt =
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

  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 700 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini cinematic prompt error ${res.status}: ${txt}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(
      `Gemini cinematic prompt returned no text: ${JSON.stringify(json).slice(0, 200)}`
    );
  }

  console.log(`[GeminiCinematic] Generated timeline prompt (${text.length} chars)`);
  return text.trim();
}

// ─── Google Drive backup upload ───────────────────────────────────────────────

/**
 * Exchange a stored OAuth2 refresh token for a short-lived access token.
 * Reuses the google_client_id / google_client_secret already in settings
 * (the same credentials used for YouTube publishing).
 *
 * To get your refresh token once:
 *   1. Go to https://developers.google.com/oauthplayground
 *   2. Click the gear icon → tick "Use your own OAuth credentials" →
 *      paste your Client ID and Client Secret.
 *   3. In "Step 1" select scope: https://www.googleapis.com/auth/drive.file
 *   4. Authorise → Exchange code for tokens → copy the Refresh Token.
 *   5. Paste it into Admin → Storage & Backup → "Google Drive Refresh Token".
 */
async function refreshGDriveToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`Google Drive token refresh error ${tokenRes.status}: ${txt}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token: string };
  return tokenJson.access_token;
}

/**
 * Upload a video Buffer to Google Drive and return a public shareable link.
 *
 * Uses your own Google account via an OAuth2 refresh token — no service
 * account needed.  The uploaded file is shared as "anyone with link can view".
 *
 * @param videoBuffer   Raw MP4 bytes
 * @param fileName      File name (e.g. "ad_abc123.mp4")
 * @param folderId      Google Drive folder ID (from the folder URL)
 * @param clientId      Google OAuth Client ID (reuses the YouTube setting)
 * @param clientSecret  Google OAuth Client Secret (reuses the YouTube setting)
 * @param refreshToken  Drive refresh token from OAuth Playground (gdrive_refresh_token setting)
 * @returns             Public shareable Drive link
 */
export async function uploadToGoogleDrive(
  videoBuffer: Buffer,
  fileName: string,
  folderId: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const accessToken = await refreshGDriveToken(clientId, clientSecret, refreshToken);

  // ── Multipart upload ──────────────────────────────────────────────────────
  const boundary = 'adavatar_gdrive_boundary_' + Date.now();
  const metadata = JSON.stringify({ name: fileName, mimeType: 'video/mp4', parents: [folderId] });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(metadata),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`),
    videoBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
      },
      body,
      signal: AbortSignal.timeout(180_000),
    }
  );

  if (!uploadRes.ok) {
    const txt = await uploadRes.text();
    throw new Error(`Google Drive upload error ${uploadRes.status}: ${txt}`);
  }

  const { id: fileId } = (await uploadRes.json()) as { id: string };

  // ── Make the file publicly readable (anyone with link) ────────────────────
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    signal: AbortSignal.timeout(15_000),
  });

  const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
  console.log(`[GDrive] Backed up ${fileName} → ${driveUrl}`);
  return driveUrl;
}
