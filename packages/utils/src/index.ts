import type { ApiError, ApiResponse, ApiResult } from '@adavatar/types';

// ─── API Helpers ──────────────────────────────────────────────────────────────

export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { data, success: true };
}

export function apiError(error: string, code: string): ApiError {
  return { error, code, success: false };
}

export function isApiError<T>(result: ApiResult<T>): result is ApiError {
  return !result.success;
}

// ─── Prompt Enhancement ───────────────────────────────────────────────────────

// Phrases users type as instructions-to-AI rather than scene descriptions
const META_INSTRUCTION_PATTERNS = [
  /\bcreate\s+(an?\s+)?ad\b/gi,
  /\bmake\s+(an?\s+)?(ad|video)\b/gi,
  /\bgenerate\s+(an?\s+)?(ad|video)\b/gi,
  /\bfor\s+me\b/gi,
  /\bi\s+want\s+(you\s+to\s+)?/gi,
  /\bplease\b/gi,
];

export function enhanceAdPrompt(
  rawPrompt: string,
  aspectRatio: string,
  options?: { avatarName?: string; productName?: string; duration?: number }
): string {
  const ratioContext: Record<string, string> = {
    '9:16': 'vertical portrait format',
    '16:9': 'landscape widescreen format',
    '1:1': 'square format',
  };

  // Strip meta-instructions — the model needs a scene description, not a request
  let scene = rawPrompt.trim();
  for (const pattern of META_INSTRUCTION_PATTERNS) {
    scene = scene.replace(pattern, '');
  }
  // Replace 'avatar' (the word) with the actual person's name so the model doesn't
  // render a cartoon/digital character
  if (options?.avatarName) {
    scene = scene.replace(/\bavatar\b/gi, options.avatarName);
  }
  scene = scene
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();

  const parts = [
    scene,
    options?.avatarName ? `Featuring ${options.avatarName}.` : '',
    options?.productName ? `Product: ${options.productName}.` : '',
    // UGC-style direction so the model produces authentic creator-style content
    'Close-up handheld shots, natural lighting, authentic UGC style.',
    'Photorealistic, stable motion, no distortion.',
    `${ratioContext[aspectRatio] ?? aspectRatio}.`,
  ];

  return parts.filter(Boolean).join(' ');
}

/**
 * Standard negative prompt for DashScope I2V — suppresses common hallucinations.
 */
export const DASHSCOPE_NEGATIVE_PROMPT =
  'blurry, distorted, extra hands, extra limbs, morphing, dissolving, ' +
  'low quality, pixelated, watermark, text overlay, multiple products, ' +
  'object duplication, unrealistic motion, artifacts';

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidImageMime(mime: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(mime);
}

export function isValidVideoMime(mime: string): boolean {
  return ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'].includes(mime);
}

export function isValidUploadMime(mime: string): boolean {
  return isValidImageMime(mime) || isValidVideoMime(mime);
}

export function bytesToMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

// ─── String Utilities ─────────────────────────────────────────────────────────

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

export function parseHashtags(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter((tag) => tag.length > 0)
    .map((tag) => `#${tag}`);
}

// ─── Date Utilities ───────────────────────────────────────────────────────────

export function isExpiredSoon(expiresAt: Date, thresholdHours = 24): boolean {
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  return expiresAt.getTime() - Date.now() < thresholdMs;
}

export function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// ─── Retry Helper ─────────────────────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  throw lastError;
}

// ─── Queue Names ──────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  AVATAR_PROCESSING: 'avatar_processing',
  AD_GENERATION: 'ad_generation',
  SOCIAL_PUBLISHING: 'social_publishing',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Cloudinary Paths ─────────────────────────────────────────────────────────

export const CLOUDINARY_FOLDERS = {
  RAW_UPLOADS: 'raw_uploads',
  PROCESSED_AVATARS: 'processed_avatars',
  GENERATED_ADS: 'generated_ads',
  PRODUCT_IMAGES: 'product_images',
} as const;
