import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin, type AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const usageRouter = Router();

// ─── GET /api/usage — current user's live usage + limits ──────────────────────
usageRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.userId!;
    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });
    if (!user) return next(createError('User not found', 404, 'NOT_FOUND'));

    const [limits, dailyUsages, monthlyUsages] = await prisma.$transaction([
      prisma.usageLimit.findMany({ where: { tier: user.tier } }),
      prisma.dailyUsage.findMany({ where: { userId, date: todayDate } }),
      prisma.monthlyUsage.findMany({ where: { userId, year, month } }),
    ]);

    const features = ['avatar_creation', 'ad_generation', 'publish_jobs'];
    const data = features.map((feature) => {
      const limit = limits.find((l) => l.feature === feature);
      const daily = dailyUsages.find((d) => d.feature === feature);
      const monthly = monthlyUsages.find((m) => m.feature === feature);
      return {
        feature,
        tier: user.tier,
        daily: {
          used: daily?.count ?? 0,
          limit: limit?.dailyLimit ?? null,
        },
        monthly: {
          used: monthly?.count ?? 0,
          limit: limit?.monthlyLimit ?? null,
        },
      };
    });

    res.json({ data, success: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/usage/history — last 7 days + last 3 months ─────────────────────
usageRouter.get('/history', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.userId!;
    const now = new Date();

    // 7 days back
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startDate = new Date(
      sevenDaysAgo.getFullYear(),
      sevenDaysAgo.getMonth(),
      sevenDaysAgo.getDate()
    );

    // 3 months back (year/month pairs)
    const monthPairs: { year: number; month: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthPairs.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const [dailyRows, monthlyRows] = await Promise.all([
      prisma.dailyUsage.findMany({
        where: { userId, date: { gte: startDate } },
        orderBy: [{ date: 'asc' }, { feature: 'asc' }],
      }),
      prisma.monthlyUsage.findMany({
        where: {
          userId,
          OR: monthPairs.map((p) => ({ year: p.year, month: p.month })),
        },
        orderBy: [{ year: 'asc' }, { month: 'asc' }, { feature: 'asc' }],
      }),
    ]);

    res.json({ data: { daily: dailyRows, monthly: monthlyRows }, success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Admin: GET /api/usage/admin/limits — all tiers + features ────────────────
usageRouter.get('/admin/limits', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const limits = await prisma.usageLimit.findMany({
      orderBy: [{ tier: 'asc' }, { feature: 'asc' }],
    });
    res.json({ data: limits, success: true });
  } catch (err) {
    next(err);
  }
});

const updateLimitSchema = z.object({
  tier: z.enum(['free', 'pro', 'enterprise']),
  feature: z.string().min(1),
  dailyLimit: z.number().int().positive().nullable(),
  monthlyLimit: z.number().int().positive().nullable(),
});

// ─── Admin: PUT /api/usage/admin/limits — update one row ──────────────────────
usageRouter.put('/admin/limits', requireAuth, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const body = updateLimitSchema.parse(req.body);

    // Read old values for audit log
    const existing = await prisma.usageLimit.findUnique({
      where: { tier_feature: { tier: body.tier, feature: body.feature } },
    });

    const updated = await prisma.usageLimit.upsert({
      where: { tier_feature: { tier: body.tier, feature: body.feature } },
      create: {
        tier: body.tier,
        feature: body.feature,
        dailyLimit: body.dailyLimit,
        monthlyLimit: body.monthlyLimit,
        updatedBy: req.userId!,
      },
      update: {
        dailyLimit: body.dailyLimit,
        monthlyLimit: body.monthlyLimit,
        updatedBy: req.userId!,
      },
    });

    // Audit log entries
    const logs: Promise<unknown>[] = [];
    if (existing?.dailyLimit !== body.dailyLimit) {
      logs.push(
        prisma.limitChangeLog.create({
          data: {
            adminId: req.userId!,
            tier: body.tier,
            feature: body.feature,
            oldValue: existing?.dailyLimit ?? null,
            newValue: body.dailyLimit,
            limitType: 'daily',
          },
        })
      );
    }
    if (existing?.monthlyLimit !== body.monthlyLimit) {
      logs.push(
        prisma.limitChangeLog.create({
          data: {
            adminId: req.userId!,
            tier: body.tier,
            feature: body.feature,
            oldValue: existing?.monthlyLimit ?? null,
            newValue: body.monthlyLimit,
            limitType: 'monthly',
          },
        })
      );
    }
    await Promise.all(logs);

    res.json({ data: updated, success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Admin: GET /api/usage/admin/logs — change history ───────────────────────
usageRouter.get('/admin/logs', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const logs = await prisma.limitChangeLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ data: logs, success: true });
  } catch (err) {
    next(err);
  }
});
