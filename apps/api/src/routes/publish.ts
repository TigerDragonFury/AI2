import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { socialPublishingQueue } from '../lib/queues';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { createError } from '../middleware/errorHandler';
import { checkUsageLimit } from '../middleware/checkUsageLimit';

export const publishRouter = Router();

const publishSchema = z.object({
  adId: z.string().cuid(),
  platforms: z.array(z.enum(['tiktok', 'youtube', 'instagram', 'facebook', 'snapchat'])).min(1),
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string()).max(30).default([]),
  scheduledAt: z.string().datetime().optional(),
});

// POST /api/publish
publishRouter.post(
  '/',
  requireAuth,
  rateLimiter('publish'),
  checkUsageLimit('publish_jobs'),
  async (req: AuthRequest, res, next) => {
    try {
      const body = publishSchema.parse(req.body);

      const ad = await prisma.ad.findFirst({
        where: { id: body.adId, userId: req.userId!, status: 'ready' },
      });
      if (!ad) return next(createError('Ad not found or not ready', 404, 'AD_NOT_READY'));

      // Verify platform tokens exist for each platform
      const tokens = await prisma.platformToken.findMany({
        where: {
          userId: req.userId!,
          platform: { in: body.platforms },
          isExpired: false,
        },
      });

      const connectedPlatforms = tokens.map((t) => t.platform);
      const missingPlatforms = body.platforms.filter((p) => !connectedPlatforms.includes(p));

      if (missingPlatforms.length > 0) {
        return next(
          createError(
            `Not connected to: ${missingPlatforms.join(', ')}`,
            400,
            'PLATFORM_NOT_CONNECTED'
          )
        );
      }

      const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;

      const jobs = await prisma.$transaction(
        tokens.map((token: { id: string; platform: string }) =>
          prisma.publishJob.create({
            data: {
              userId: req.userId!,
              adId: body.adId,
              platformTokenId: token.id,
              platform: token.platform as never,
              caption: body.caption,
              hashtags: body.hashtags,
              scheduledAt,
              status: 'pending',
            },
          })
        )
      );

      // Enqueue social publishing jobs
      await Promise.all(
        jobs.map((job: { id: string }) =>
          socialPublishingQueue.add('publish-ad', { publishJobId: job.id })
        )
      );

      res.status(201).json({ data: jobs, success: true });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/publish — list all publish jobs
publishRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { platform, status, page = '1', limit = '20' } = req.query as Record<string, string>;

    const jobs = await prisma.publishJob.findMany({
      where: {
        userId: req.userId!,
        ...(platform ? { platform: platform as never } : {}),
        ...(status ? { status: status as never } : {}),
      },
      include: {
        ad: { select: { id: true, generatedVideoUrl: true, rawPrompt: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    });

    res.json({ data: jobs, success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/publish/:id/retry
publishRouter.post(
  '/:id/retry',
  requireAuth,
  rateLimiter('publish'),
  async (req: AuthRequest, res, next) => {
    try {
      const job = await prisma.publishJob.findFirst({
        where: { id: req.params.id, userId: req.userId!, status: 'failed' },
      });
      if (!job) return next(createError('Publish job not found or not failed', 404, 'NOT_FOUND'));

      const updated = await prisma.publishJob.update({
        where: { id: job.id },
        data: { status: 'pending', errorMessage: null },
      });

      await socialPublishingQueue.add('publish-ad', { publishJobId: updated.id });
      res.json({ data: updated, success: true });
    } catch (err) {
      next(err);
    }
  }
);
