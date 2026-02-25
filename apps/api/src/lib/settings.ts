import { prisma } from './prisma';

/**
 * In-memory cache — same pattern as the worker.
 * Each setting is cached for 60 s so we don't hammer the DB on every request.
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: string | undefined;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Read a setting from the database, falling back to the named env var.
 * Results are cached for 60 s.
 */
export async function getAppSetting(
  key: string,
  envFallback?: string
): Promise<string | undefined> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  let dbValue: string | undefined;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    dbValue = row?.value ?? undefined;
  } catch {
    // DB unavailable — fall through to env
  }

  const value = dbValue ?? (envFallback ? process.env[envFallback] : undefined);
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/** Clear the cache for one key (call after a successful PUT /api/settings). */
export function bustSettingCache(key: string) {
  cache.delete(key);
}

/**
 * Lookup OAuth credentials for a social platform.
 * DB keys take priority over environment variables.
 */
export async function getPlatformCredentials(
  platform: string
): Promise<{ clientId: string; clientSecret: string } | null> {
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  switch (platform) {
    case 'tiktok':
      [clientId, clientSecret] = await Promise.all([
        getAppSetting('tiktok_client_id', 'TIKTOK_CLIENT_ID'),
        getAppSetting('tiktok_client_secret', 'TIKTOK_CLIENT_SECRET'),
      ]);
      break;
    case 'youtube':
      [clientId, clientSecret] = await Promise.all([
        getAppSetting('google_client_id', 'GOOGLE_CLIENT_ID'),
        getAppSetting('google_client_secret', 'GOOGLE_CLIENT_SECRET'),
      ]);
      break;
    case 'instagram':
    case 'facebook':
      [clientId, clientSecret] = await Promise.all([
        getAppSetting('meta_app_id', 'META_APP_ID'),
        getAppSetting('meta_app_secret', 'META_APP_SECRET'),
      ]);
      break;
    case 'snapchat':
      [clientId, clientSecret] = await Promise.all([
        getAppSetting('snapchat_client_id', 'SNAPCHAT_CLIENT_ID'),
        getAppSetting('snapchat_client_secret', 'SNAPCHAT_CLIENT_SECRET'),
      ]);
      break;
    default:
      return null;
  }

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
