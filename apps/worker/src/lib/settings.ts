import { prisma } from './prisma';
import { AI_MODELS } from '@adavatar/config';

/**
 * In-memory cache for app settings so we don't hammer the DB on every job.
 * Each entry expires after TTL_MS. On cache miss we hit the DB once.
 */
const CACHE_TTL_MS = 60_000; // 1 minute

interface CacheEntry {
  value: string | undefined;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Get an app setting value from the database.
 * Falls back to the matching environment variable if not set in DB.
 * Caches results for 60 s to keep DB round-trips low.
 *
 * @param key   The setting key (e.g. 'ai_provider', 'alibaba_api_key')
 * @param envFallback  Name of the env var to use when the DB has no value
 */
export async function getAppSetting(
  key: string,
  envFallback?: string
): Promise<string | undefined> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let dbValue: string | undefined;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    dbValue = row?.value ?? undefined;
  } catch (err) {
    console.warn(`[settings] Could not read "${key}" from DB, using env fallback:`, err);
  }

  const value = dbValue ?? (envFallback ? process.env[envFallback] : undefined);
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/**
 * Bust the cache for a specific key (e.g. after an update via API).
 */
export function bustSettingCache(key: string) {
  cache.delete(key);
}

/**
 * Detect the active AI provider.
 * Priority: DB setting > AI_PROVIDER env > infer from keys.
 */
export async function detectProvider(): Promise<string> {
  // 1. Explicit DB or env setting
  const explicit = await getAppSetting('ai_provider', 'AI_PROVIDER');
  if (explicit) return explicit.toLowerCase();

  // 2. Infer from whichever key is available in DB or env
  const [aliKey, falKey, hfKey, geminiKey, klingKey] = await Promise.all([
    getAppSetting('alibaba_api_key', 'ALIBABA_API_KEY'),
    getAppSetting('fal_key', 'FAL_KEY'),
    getAppSetting('huggingface_api_key', 'HUGGINGFACE_API_TOKEN'),
    getAppSetting('gemini_api_key', 'GEMINI_API_KEY'),
    getAppSetting('kling_api_key', 'KLING_API_KEY'),
  ]);

  if (aliKey) return 'dashscope';
  if (falKey) return 'fal';
  if (geminiKey) return 'google';
  if (klingKey) return 'kling';
  if (hfKey) return 'huggingface';

  return 'dashscope'; // default — will show a descriptive error if key missing
}

/**
 * Get the API key for the given provider, checking DB first then env vars.
 */
export async function getProviderKey(provider: string): Promise<string | undefined> {
  switch (provider) {
    case 'dashscope':
      return getAppSetting('alibaba_api_key', 'ALIBABA_API_KEY');
    case 'fal':
      return getAppSetting('fal_key', 'FAL_KEY');
    case 'huggingface':
      return getAppSetting('huggingface_api_key', 'HUGGINGFACE_API_TOKEN');
    case 'google':
      return getAppSetting('gemini_api_key', 'GEMINI_API_KEY');
    case 'kling':
      return getAppSetting('kling_api_key', 'KLING_API_KEY');
    default:
      return undefined;
  }
}

/**
 * Get the active AI model IDs for each pipeline step.
 * DB values (set via admin settings UI) take priority; code defaults are the fallback.
 * Cached for 60 s alongside all other settings.
 */
export async function getModelConfig() {
  const [
    ttsModel,
    dialogueLlm,
    visionLlm,
    i2vModel,
    i2iModel,
    veoModel,
    geminiTtsModel,
    klingVeoModel,
    cinematicPromptModel,
    kieVisionModel,
  ] = await Promise.all([
    getAppSetting('tts_model'),
    getAppSetting('dialogue_model'),
    getAppSetting('vision_model'),
    getAppSetting('i2v_model'),
    getAppSetting('i2i_model'),
    getAppSetting('veo_model'),
    getAppSetting('gemini_tts_model'),
    getAppSetting('kling_veo_model'),
    getAppSetting('cinematic_prompt_model'),
    getAppSetting('kie_vision_model'),
  ]);
  return {
    ttsModel: ttsModel ?? AI_MODELS.DASHSCOPE_TTS,
    dialogueLlm: dialogueLlm ?? AI_MODELS.DASHSCOPE_DIALOGUE_LLM,
    visionLlm: visionLlm ?? AI_MODELS.DASHSCOPE_VISION_LLM,
    i2vModel: i2vModel ?? AI_MODELS.DASHSCOPE_AD_GENERATION_I2V,
    i2iModel: i2iModel ?? AI_MODELS.DASHSCOPE_AD_IMAGE_EDIT,
    veoModel: veoModel ?? AI_MODELS.VEO_AD_GENERATION,
    geminiTtsModel: geminiTtsModel ?? AI_MODELS.GEMINI_TTS,
    // Default to Sora 2 I2V — matches the Hollywood UGC workflow out of the box
    klingVeoModel: klingVeoModel ?? AI_MODELS.KIE_SORA2_I2V,
    // cinematicPromptModel is only used for the Google direct path (gemini-2.0-flash works there).
    // For the kling path, the worker uses kieVisionModel instead (gemini-2.5-flash via Kie.ai).
    cinematicPromptModel: cinematicPromptModel ?? AI_MODELS.GEMINI_CINEMATIC_PROMPT,
    kieVisionModel: kieVisionModel ?? AI_MODELS.KIE_VISION_MODEL,
  };
}

/**
 * Get storage/backup configuration.
 * storage_backup: 'cloudinary_only' (default) | 'cloudinary_gdrive'
 * gdrive_folder_id: target Drive folder ID
 * gdrive_service_account_json: full service-account JSON string
 */
export async function getStorageConfig(): Promise<{
  backup: string;
  gdriveFolderId: string | undefined;
  gdriveClientId: string | undefined;
  gdriveClientSecret: string | undefined;
  gdriveRefreshToken: string | undefined;
}> {
  const [backup, gdriveFolderId, gdriveClientId, gdriveClientSecret, gdriveRefreshToken] =
    await Promise.all([
      getAppSetting('storage_backup'),
      getAppSetting('gdrive_folder_id'),
      // Reuse the same Google OAuth credentials already configured for YouTube
      getAppSetting('google_client_id', 'GOOGLE_CLIENT_ID'),
      getAppSetting('google_client_secret', 'GOOGLE_CLIENT_SECRET'),
      getAppSetting('gdrive_refresh_token'),
    ]);
  return {
    backup: backup ?? 'cloudinary_only',
    gdriveFolderId,
    gdriveClientId,
    gdriveClientSecret,
    gdriveRefreshToken,
  };
}
