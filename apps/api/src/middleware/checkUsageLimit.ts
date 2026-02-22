import type { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from './auth';

export type UsageFeature = 'avatar_creation' | 'ad_generation' | 'publish_jobs';

/**
 * Middleware factory: checks daily AND monthly limits for the authenticated user.
 * Must be used after `requireAuth`.
 *
 * On success: increments both counters atomically and calls next().
 * On limit breach: responds 429 with `code: 'daily_limit_reached' | 'monthly_limit_reached'`.
 */
export function checkUsageLimit(feature: UsageFeature) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const now = new Date();

      // Dates/keys
      const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // Get user tier
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tier: true },
      });
      if (!user) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED', success: false });
        return;
      }

      // Get limits for this tier + feature
      const limitRow = await prisma.usageLimit.findUnique({
        where: { tier_feature: { tier: user.tier, feature } },
      });

      // ── Daily check ──────────────────────────────────────────────────────────
      if (limitRow?.dailyLimit != null) {
        const daily = await prisma.dailyUsage.findUnique({
          where: { userId_feature_date: { userId, feature, date: todayDate } },
        });
        if ((daily?.count ?? 0) >= limitRow.dailyLimit) {
          res.status(429).json({
            error: `Daily limit of ${limitRow.dailyLimit} reached for ${feature}`,
            code: 'daily_limit_reached',
            success: false,
          });
          return;
        }
      }

      // ── Monthly check ─────────────────────────────────────────────────────────
      if (limitRow?.monthlyLimit != null) {
        const monthly = await prisma.monthlyUsage.findUnique({
          where: { userId_feature_year_month: { userId, feature, year, month } },
        });
        if ((monthly?.count ?? 0) >= limitRow.monthlyLimit) {
          res.status(429).json({
            error: `Monthly limit of ${limitRow.monthlyLimit} reached for ${feature}`,
            code: 'monthly_limit_reached',
            success: false,
          });
          return;
        }
      }

      // ── Increment both atomically ─────────────────────────────────────────────
      await prisma.$transaction([
        prisma.dailyUsage.upsert({
          where: { userId_feature_date: { userId, feature, date: todayDate } },
          create: { userId, feature, date: todayDate, count: 1 },
          update: { count: { increment: 1 } },
        }),
        prisma.monthlyUsage.upsert({
          where: { userId_feature_year_month: { userId, feature, year, month } },
          create: { userId, feature, year, month, count: 1 },
          update: { count: { increment: 1 } },
        }),
      ]);

      next();
    } catch (err) {
      next(err);
    }
  };
}
