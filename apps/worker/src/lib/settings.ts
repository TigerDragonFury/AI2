import { prisma } from './prisma';

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
  const [aliKey, falKey, hfKey] = await Promise.all([
    getAppSetting('alibaba_api_key', 'ALIBABA_API_KEY'),
    getAppSetting('fal_key', 'FAL_KEY'),
    getAppSetting('huggingface_api_key', 'HUGGINGFACE_API_TOKEN'),
  ]);

  if (aliKey) return 'dashscope';
  if (falKey) return 'fal';
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
    default:
      return undefined;
  }
}
