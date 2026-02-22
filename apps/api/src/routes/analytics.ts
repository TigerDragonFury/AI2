import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';

export const analyticsRouter = Router();

// GET /api/analytics/overview
analyticsRouter.get('/overview', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [totalAds, totalPublished, analyticsAgg] = await Promise.all([
      prisma.ad.count({ where: { userId: req.userId!, status: 'ready' } }),
      prisma.publishJob.count({ where: { userId: req.userId!, status: 'published' } }),
      prisma.analytics.aggregate({
        where: { publishJob: { userId: req.userId! } },
        _sum: { views: true, likes: true, comments: true, shares: true },
      }),
    ]);

    res.json({
      data: {
        totalAds,
        totalPublished,
        totalViews: analyticsAgg._sum.views ?? 0,
        totalLikes: analyticsAgg._sum.likes ?? 0,
        totalComments: analyticsAgg._sum.comments ?? 0,
        totalShares: analyticsAgg._sum.shares ?? 0,
      },
      success: true,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/by-platform
analyticsRouter.get('/by-platform', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const jobs = await prisma.publishJob.findMany({
      where: { userId: req.userId!, status: 'published' },
      include: {
        analytics: {
          orderBy: { fetchedAt: 'desc' },
          take: 1,
        },
      },
    });

    const byPlatform: Record<string, { views: number; likes: number; posts: number }> = {};
    for (const job of jobs) {
      const latest = job.analytics[0];
      if (!byPlatform[job.platform]) {
        byPlatform[job.platform] = { views: 0, likes: 0, posts: 0 };
      }
      byPlatform[job.platform].posts++;
      if (latest) {
        byPlatform[job.platform].views += latest.views;
        byPlatform[job.platform].likes += latest.likes;
      }
    }

    res.json({ data: byPlatform, success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/ads
analyticsRouter.get('/ads', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ads = await prisma.ad.findMany({
      where: { userId: req.userId!, status: 'ready' },
      include: {
        publishJobs: {
          where: { status: 'published' },
          include: {
            analytics: { orderBy: { fetchedAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    type AdRow = {
      id: string;
      rawPrompt: string;
      generatedVideoUrl: string | null;
      createdAt: Date;
      publishJobs: { platform: string; analytics: { views: number; likes: number }[] }[];
    };
    const result = (ads as AdRow[]).map((ad: AdRow) => {
      let totalViews = 0;
      let totalLikes = 0;
      const platforms: string[] = [];

      for (const job of ad.publishJobs) {
        platforms.push(job.platform);
        const latest = job.analytics[0];
        if (latest) {
          totalViews += latest.views;
          totalLikes += latest.likes;
        }
      }

      return {
        id: ad.id,
        rawPrompt: ad.rawPrompt,
        generatedVideoUrl: ad.generatedVideoUrl,
        createdAt: ad.createdAt,
        platforms: [...new Set(platforms)],
        totalViews,
        totalLikes,
        publishCount: ad.publishJobs.length,
      };
    });

    res.json({ data: result, success: true });
  } catch (err) {
    next(err);
  }
});
