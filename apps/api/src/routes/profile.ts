import { Router } from 'express';
import { z } from 'zod';
import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { CLOUDINARY_FOLDERS } from '@adavatar/utils';

export const profileRouter = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BRAND_VOICE_PRESETS = ['luxury', 'casual', 'professional', 'playful', 'bold'] as const;

// GET /api/profile
profileRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        companyName: true,
        companyLogoUrl: true,
        brandVoicePreset: true,
        brandVoiceCustom: true,
        productCategories: true,
        onboardingDone: true,
      },
    });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ data: user, success: true });
  } catch (err) {
    next(err);
  }
});

const updateProfileSchema = z.object({
  companyName: z.string().max(200).optional().nullable(),
  companyLogoUrl: z.string().url().optional().nullable(),
  brandVoicePreset: z.enum(BRAND_VOICE_PRESETS).optional().nullable(),
  brandVoiceCustom: z.string().max(300).optional().nullable(),
  productCategories: z.string().max(500).optional().nullable(),
  onboardingDone: z.boolean().optional(),
});

// PATCH /api/profile
profileRouter.patch('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = updateProfileSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: req.userId! },
      data: body,
      select: {
        id: true,
        companyName: true,
        companyLogoUrl: true,
        brandVoicePreset: true,
        brandVoiceCustom: true,
        productCategories: true,
        onboardingDone: true,
      },
    });
    res.json({ data: updated, success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/logo/presign — Cloudinary upload signature for company logo
profileRouter.post(
  '/logo/presign',
  requireAuth,
  rateLimiter('upload'),
  async (req: AuthRequest, res, next) => {
    try {
      const timestamp = Math.round(Date.now() / 1000);
      const folder = CLOUDINARY_FOLDERS.BRAND_ASSETS;
      const signature = cloudinary.utils.api_sign_request(
        { timestamp, folder },
        process.env.CLOUDINARY_API_SECRET!
      );
      res.json({
        data: {
          signature,
          timestamp,
          folder,
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          apiKey: process.env.CLOUDINARY_API_KEY,
        },
        success: true,
      });
    } catch (err) {
      next(err);
    }
  }
);
