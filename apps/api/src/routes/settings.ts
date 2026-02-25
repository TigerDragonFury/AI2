import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin, type AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { bustSettingCache } from '../lib/settings';

export const settingsRouter = Router();

// Keys that are treated as secrets — values are masked when listed
const SECRET_KEYS = new Set([
  'alibaba_api_key',
  'fal_key',
  'huggingface_api_key',
  'gemini_api_key',
]);

function maskValue(key: string, value: string): string {
  if (SECRET_KEYS.has(key)) {
    if (value.length <= 8) return '***';
    return value.slice(0, 4) + '•'.repeat(value.length - 8) + value.slice(-4);
  }
  return value;
}

// ─── GET /api/settings — list all settings (values masked for secrets) ────────
settingsRouter.get('/', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
    const data = rows.map((r) => ({
      key: r.key,
      value: maskValue(r.key, r.value),
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/settings — upsert a single setting ─────────────────────────────
const upsertSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(1),
});

settingsRouter.put('/', requireAuth, requireAdmin, async (req: AuthRequest, res, next) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(createError('Invalid body: ' + parsed.error.message, 400, 'VALIDATION_ERROR'));
  }

  const { key, value } = parsed.data;

  // Restrict to known keys to avoid arbitrary data storage
  const ALLOWED_KEYS = [
    'ai_provider',
    'alibaba_api_key',
    'fal_key',
    'huggingface_api_key',
    'gemini_api_key',
    // AI model overrides — worker reads these from DB, falls back to code defaults
    'tts_model',
    'dialogue_model',
    'vision_model',
    'i2v_model',
    'i2i_model',
    'veo_model',
    // Platform OAuth credentials
    'tiktok_client_id',
    'tiktok_client_secret',
    'google_client_id',
    'google_client_secret',
    'meta_app_id',
    'meta_app_secret',
    'snapchat_client_id',
    'snapchat_client_secret',
  ];
  if (!ALLOWED_KEYS.includes(key)) {
    return next(
      createError(`Unknown key "${key}". Allowed: ${ALLOWED_KEYS.join(', ')}`, 400, 'UNKNOWN_KEY')
    );
  }

  try {
    const row = await prisma.appSetting.upsert({
      where: { key },
      update: { value, updatedBy: req.userId },
      create: { key, value, updatedBy: req.userId },
    });

    bustSettingCache(key);

    res.json({
      success: true,
      data: {
        key: row.key,
        value: maskValue(row.key, row.value),
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/settings/:key — remove a setting (reverts to env var) ────────
settingsRouter.delete('/:key', requireAuth, requireAdmin, async (req, res, next) => {
  const { key } = req.params;
  try {
    await prisma.appSetting.deleteMany({ where: { key } });
    bustSettingCache(key);
    res.json({ success: true, message: `Setting "${key}" deleted — env var fallback active` });
  } catch (err) {
    next(err);
  }
});
