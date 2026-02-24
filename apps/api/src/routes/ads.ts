import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { adGenerationQueue } from '../lib/queues';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { createError } from '../middleware/errorHandler';
import { checkUsageLimit } from '../middleware/checkUsageLimit';
import { enhanceAdPrompt } from '@adavatar/utils';

export const adsRouter = Router();

// GET /api/ads
adsRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ads = await prisma.ad.findMany({
      where: { userId: req.userId! },
      include: {
        avatar: { select: { id: true, name: true, avatarVideoUrl: true } },
        product: { select: { id: true, name: true, imageUrls: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: ads, success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/ads/:id
adsRouter.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ad = await prisma.ad.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      include: {
        avatar: true,
        product: true,
        publishJobs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!ad) return next(createError('Ad not found', 404, 'NOT_FOUND'));
    res.json({ data: ad, success: true });
  } catch (err) {
    next(err);
  }
});

const generateAdSchema = z.object({
  avatarId: z.string().cuid(),
  productId: z.string().cuid(),
  rawPrompt: z.string().min(10).max(1000),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']),
  // DashScope Wan I2V only supports 3s or 5s — other values are silently ignored by the API
  duration: z
    .union([z.literal(3), z.literal(5)])
    .optional()
    .default(5),
  // Dialogue / voiceover
  dialogueText: z.string().max(500).optional(),
  autoDialogue: z.boolean().optional().default(false),
  dialogueLanguage: z.string().max(10).optional().default('en'),
});

// POST /api/ads/generate
adsRouter.post(
  '/generate',
  requireAuth,
  rateLimiter('generation'),
  checkUsageLimit('ad_generation'),
  async (req: AuthRequest, res, next) => {
    try {
      const body = generateAdSchema.parse(req.body);

      // Validate avatar belongs to user and is ready
      const avatar = await prisma.avatar.findFirst({
        where: { id: body.avatarId, userId: req.userId!, status: 'ready' },
      });
      if (!avatar)
        return next(createError('Avatar not found or not ready', 404, 'AVATAR_NOT_READY'));

      // Validate product belongs to user
      const product = await prisma.product.findFirst({
        where: { id: body.productId, userId: req.userId! },
      });
      if (!product) return next(createError('Product not found', 404, 'NOT_FOUND'));

      const enhancedPrompt = enhanceAdPrompt(body.rawPrompt, body.aspectRatio, {
        avatarName: avatar.name,
        productName: product.name,
        duration: body.duration,
      });

      const aspectRatioMap: Record<string, 'RATIO_9_16' | 'RATIO_16_9' | 'RATIO_1_1'> = {
        '9:16': 'RATIO_9_16',
        '16:9': 'RATIO_16_9',
        '1:1': 'RATIO_1_1',
      };

      const ad = await prisma.ad.create({
        data: {
          userId: req.userId!,
          avatarId: body.avatarId,
          productId: body.productId,
          rawPrompt: body.rawPrompt,
          enhancedPrompt,
          aspectRatio: aspectRatioMap[body.aspectRatio],
          duration: body.duration,
          dialogueText: body.dialogueText ?? null,
          dialogueLanguage: body.dialogueLanguage ?? 'en',
          autoDialogue: body.autoDialogue ?? false,
          status: 'pending',
        },
      });

      // Job will be picked up by the worker queue (best-effort — Redis may be unavailable in dev)
      try {
        await adGenerationQueue.add('generate-ad', { adId: ad.id });
      } catch (qErr) {
        console.warn('[queue] adGenerationQueue unavailable:', (qErr as Error).message);
      }
      res.status(201).json({ data: ad, success: true });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/ads/:id/regenerate
adsRouter.patch(
  '/:id/regenerate',
  requireAuth,
  rateLimiter('generation'),
  async (req: AuthRequest, res, next) => {
    try {
      const ad = await prisma.ad.findFirst({
        where: { id: req.params.id, userId: req.userId! },
      });
      if (!ad) return next(createError('Ad not found', 404, 'NOT_FOUND'));

      const { rawPrompt } = z.object({ rawPrompt: z.string().min(10).max(1000) }).parse(req.body);

      const aspectRatioReverseMap: Record<string, string> = {
        RATIO_9_16: '9:16',
        RATIO_16_9: '16:9',
        RATIO_1_1: '1:1',
      };

      const adWithRelations = await prisma.ad.findFirst({
        where: { id: ad.id },
        include: { avatar: { select: { name: true } }, product: { select: { name: true } } },
      });

      const enhancedPrompt = enhanceAdPrompt(rawPrompt, aspectRatioReverseMap[ad.aspectRatio], {
        avatarName: adWithRelations?.avatar?.name,
        productName: adWithRelations?.product?.name,
        duration: ad.duration,
      });

      const updated = await prisma.ad.update({
        where: { id: ad.id },
        data: {
          rawPrompt,
          enhancedPrompt,
          status: 'pending',
          generatedVideoUrl: null,
          errorMessage: null,
        },
      });

      try {
        await adGenerationQueue.add('generate-ad', { adId: updated.id });
      } catch (qErr) {
        console.warn('[queue] adGenerationQueue unavailable:', (qErr as Error).message);
      }
      res.json({ data: updated, success: true });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/ads/:id
adsRouter.delete('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ad = await prisma.ad.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!ad) return next(createError('Ad not found', 404, 'NOT_FOUND'));

    await prisma.ad.delete({ where: { id: ad.id } });
    res.json({ data: { id: ad.id }, success: true });
  } catch (err) {
    next(err);
  }
});
