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
  // HuggingFace (router.huggingface.co) — requires Pro tier for some models
  HF_AVATAR_ANIMATION: 'KwaiVGI/LivePortrait',
  HF_AD_GENERATION_I2V: 'Wan-AI/Wan2.1-I2V-14B-480P', // HF hasn't released 2.2 yet
  HF_AD_GENERATION_FALLBACK: 'THUDM/CogVideoX-5b-I2V',

  // fal.ai (queue.fal.run) — free $10 credits on signup
  FAL_AVATAR_ANIMATION: 'fal-ai/live-portrait',
  FAL_AD_GENERATION_I2V: 'fal-ai/wan/i2v',

  // Alibaba Cloud DashScope (dashscope-intl.aliyuncs.com) — 90 days free quota for new users
  // https://www.alibabacloud.com/help/en/model-studio/new-free-quota
  DASHSCOPE_AVATAR_ANIMATION: 'wan2.1-i2v-turbo', // image → animated video
  DASHSCOPE_AD_GENERATION_I2V: 'wan2.6-i2v', // Wan2.6 image-to-video
  DASHSCOPE_AD_IMAGE_EDIT: 'wan2.5-i2i-preview', // Step 1: multi-image fusion (avatar + product → composite)

  // Google Gemini API (generativelanguage.googleapis.com)
  VEO_AD_GENERATION: 'veo-3.1-generate-preview', // Veo 3.1 — reference-image video generation
  GEMINI_TTS: 'gemini-2.5-flash-preview-tts', // Gemini TTS — multilingual, no language config needed

  // Kie.ai Veo 3.1 API (api.kie.ai) — 25% of Google direct pricing, REFERENCE_2_VIDEO support
  KLING_VEO_FAST: 'veo3_fast', // Veo 3.1 Fast — cost-efficient, supports REFERENCE_2_VIDEO
  KLING_VEO_QUALITY: 'veo3', // Veo 3.1 Quality — highest fidelity, image-to-video only

  // Kie.ai Unified API — Sora 2, Kling 3.0/2.1 (POST /api/v1/jobs/createTask)
  KIE_SORA2_I2V: 'sora-2-pro-image-to-video', // Sora 2 Pro — image-to-video (up to 3 refs)
  KIE_SORA2_T2V: 'sora-2-pro-text-to-video', // Sora 2 Pro — text-to-video
  KIE_KLING_V3: 'kling/v3.0', // Kling 3.0 — latest generation
  KIE_KLING_V21_PRO: 'kling/v2-1-pro', // Kling 2.1 Pro — high quality
  KIE_KLING_V21_STD: 'kling/v2-1-standard', // Kling 2.1 Standard — faster/cheaper
  KIE_WAN_26: 'wan/2-2-a14b', // Wan 2.6 via Kie.ai
  KIE_ELEVENLABS_TTS: 'elevenlabs-v3', // ElevenLabs V3 TTS via Kie.ai

  DASHSCOPE_TTS: 'qwen3-tts-flash', // Qwen3-TTS-Flash — REST multimodal-generation endpoint
  DASHSCOPE_DIALOGUE_LLM: 'qwen-plus', // Qwen text model for auto-generating dialogue scripts
  DASHSCOPE_VISION_LLM: 'qwen-vl-plus', // Qwen VL multimodal model for product image analysis

  // Cinematic timeline prompt expansion (Gemini text model)
  GEMINI_CINEMATIC_PROMPT: 'gemini-2.0-flash', // Fast & cheap — only generates text, no vision needed

  // Legacy aliases (kept for backward compat)
  AVATAR_ANIMATION: 'KwaiVGI/LivePortrait',
  AD_GENERATION_I2V: 'Wan-AI/Wan2.1-I2V-14B-480P', // legacy alias
  AD_GENERATION_FALLBACK: 'THUDM/CogVideoX-5b-I2V',
} as const;

// ─── Generated Ad Settings ────────────────────────────────────────────────────

export const AD_GENERATION = {
  BASE_DURATION_SEC: 5,
  POLL_INTERVAL_MS: 5000,
  MAX_POLL_ATTEMPTS: 60, // 5 min max
} as const;

// ─── Voice / Dialogue Config ──────────────────────────────────────────────────

/**
 * CosyVoice v3 supports multilingual output — the same voice can speak any language
 * based on the text content. These voices are default assignments per language.
 * See: https://www.alibabacloud.com/help/en/model-studio/cosyvoice
 */
export const TTS_VOICE_BY_LANGUAGE: Record<string, string> = {
  en: 'Cherry',
  ar: 'Cherry',
  fr: 'Cherry',
  es: 'Cherry',
  de: 'Cherry',
  ja: 'Cherry',
  ko: 'Cherry',
  zh: 'Cherry',
};

export const SUPPORTED_DIALOGUE_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic (العربية)' },
  { value: 'fr', label: 'French (Français)' },
  { value: 'es', label: 'Spanish (Español)' },
  { value: 'de', label: 'German (Deutsch)' },
  { value: 'ja', label: 'Japanese (日本語)' },
  { value: 'ko', label: 'Korean (한국어)' },
  { value: 'zh', label: 'Chinese (中文)' },
] as const;

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
