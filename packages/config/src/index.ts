// ─── App Constants ────────────────────────────────────────────────────────────

export const APP_NAME = 'AdAvatar';
export const APP_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

// ─── Upload Limits ────────────────────────────────────────────────────────────

export const UPLOAD_LIMITS = {
  AVATAR_MAX_SIZE_BYTES: 200 * 1024 * 1024, // 200 MB
  PRODUCT_IMAGE_MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  PRODUCT_MAX_IMAGES: 10,
  AVATAR_MIN_IMAGE_DIMENSION: 256, // px — lowered from 512 to accept typical downloaded/cropped images
  AVATAR_MIN_VIDEO_DURATION_SEC: 2,
  AVATAR_MAX_VIDEO_DURATION_SEC: 60,
  AVATAR_MIN_VIDEO_RESOLUTION: 480, // px height — lowered from 720
} as const;

// ─── Rate Limits (requests per minute) ───────────────────────────────────────

export const RATE_LIMITS = {
  UPLOAD: 100,
  GENERATION: 50,
  PUBLISH: 100,
} as const;

// ─── BullMQ Job Options ───────────────────────────────────────────────────────

export const JOB_OPTIONS = {
  ATTEMPTS: 3,
  BACKOFF: {
    type: 'exponential' as const,
    delay: 2000,
  },
  REMOVE_ON_COMPLETE: { count: 100 },
  REMOVE_ON_FAIL: { count: 500 },
} as const;

// ─── AI Model IDs ─────────────────────────────────────────────────────────────

export const AI_MODELS = {
  AVATAR_ANIMATION: 'KwaiVGI/LivePortrait',
  AD_GENERATION_I2V: 'Wan-AI/Wan2.1-I2V-14B-480P',
  AD_GENERATION_FALLBACK: 'THUDM/CogVideoX-5b-I2V',
} as const;

// ─── Generated Ad Settings ────────────────────────────────────────────────────

export const AD_GENERATION = {
  BASE_DURATION_SEC: 5,
  POLL_INTERVAL_MS: 5000,
  MAX_POLL_ATTEMPTS: 60, // 5 min max
} as const;

// ─── Platform Configs ─────────────────────────────────────────────────────────

export const PLATFORM_OAUTH = {
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scope: 'user.info.basic,video.publish',
  },
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
  },
  instagram: {
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scope: 'instagram_basic,instagram_content_publish',
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scope: 'pages_manage_posts,pages_read_engagement',
  },
  snapchat: {
    authUrl: 'https://accounts.snapchat.com/accounts/oauth2/auth',
    tokenUrl: 'https://accounts.snapchat.com/accounts/oauth2/token',
    scope: 'snapchat-marketing-api',
  },
} as const;

// ─── Token Refresh Threshold ──────────────────────────────────────────────────

export const TOKEN_REFRESH_THRESHOLD_HOURS = 24;

// ─── Analytics Cron ──────────────────────────────────────────────────────────

export const ANALYTICS_CRON = '0 2 * * *'; // 2 AM daily
export const TOKEN_REFRESH_CRON = '0 */6 * * *'; // every 6 hours
export const MONTHLY_RESET_CRON = '0 0 1 * *'; // midnight UTC on 1st of month

// ─── YouTube Defaults ─────────────────────────────────────────────────────────

export const YOUTUBE_DEFAULT_CATEGORY_ID = '22'; // People & Blogs
