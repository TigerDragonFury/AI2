import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { avatarProcessingQueue } from '../lib/queues';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { checkUsageLimit } from '../middleware/checkUsageLimit';
import { createError } from '../middleware/errorHandler';
import { CLOUDINARY_FOLDERS } from '@adavatar/utils';
import { v2 as cloudinary } from 'cloudinary';

export const avatarsRouter = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// GET /api/avatars — list all avatars for authenticated user
avatarsRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const avatars = await prisma.avatar.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: avatars, success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/avatars/:id
avatarsRouter.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const avatar = await prisma.avatar.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!avatar) return next(createError('Avatar not found', 404, 'NOT_FOUND'));
    res.json({ data: avatar, success: true });
  } catch (err) {
    next(err);
  }
});

const createAvatarSchema = z.object({
  name: z.string().min(1).max(100),
  rawUrl: z.string().url(),
  inputType: z.enum(['image', 'video']),
});

// POST /api/avatars — create avatar record after upload
avatarsRouter.post(
  '/',
  requireAuth,
  rateLimiter('upload'),
  checkUsageLimit('avatar_creation'),
  async (req: AuthRequest, res, next) => {
    try {
      const body = createAvatarSchema.parse(req.body);
      const avatar = await prisma.avatar.create({
        data: {
          userId: req.userId!,
          name: body.name,
          rawUrl: body.rawUrl,
          inputType: body.inputType,
          status: 'processing',
        },
      });
      // Enqueue avatar processing job (best-effort — Redis may be unavailable in dev)
      try {
        await avatarProcessingQueue.add('process-avatar', { avatarId: avatar.id });
      } catch (qErr) {
        console.warn('[queue] avatarProcessingQueue unavailable:', (qErr as Error).message);
      }
      res.status(201).json({ data: avatar, success: true });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/avatars/:id
avatarsRouter.delete('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const avatar = await prisma.avatar.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!avatar) return next(createError('Avatar not found', 404, 'NOT_FOUND'));

    // Remove from Cloudinary
    const publicId = `${CLOUDINARY_FOLDERS.PROCESSED_AVATARS}/${avatar.id}`;
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }).catch(() => null);

    await prisma.avatar.delete({ where: { id: avatar.id } });
    res.json({ data: { id: avatar.id }, success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/avatars/presign — get a presigned Cloudinary upload URL
avatarsRouter.post(
  '/presign',
  requireAuth,
  rateLimiter('upload'),
  async (req: AuthRequest, res, next) => {
    try {
      const timestamp = Math.round(Date.now() / 1000);
      const folder = CLOUDINARY_FOLDERS.RAW_UPLOADS;
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
