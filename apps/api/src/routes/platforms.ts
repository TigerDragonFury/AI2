import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import type { PlatformName } from '@adavatar/types';

export const platformsRouter = Router();

const SUPPORTED_PLATFORMS: PlatformName[] = [
  'tiktok',
  'youtube',
  'instagram',
  'facebook',
  'snapchat',
];

// GET /api/platforms — list connected platforms for the user
platformsRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const tokens = await prisma.platformToken.findMany({
      where: { userId: req.userId! },
      select: {
        id: true,
        platform: true,
        platformUsername: true,
        isExpired: true,
        expiresAt: true,
        updatedAt: true,
      },
    });

    type PlatformInfo = {
      connected: boolean;
      username: string | null;
      isExpired: boolean;
      expiresAt: Date | null;
    };
    type TokenRow = {
      platform: string;
      platformUsername: string;
      isExpired: boolean;
      expiresAt: Date | null;
    };
    const connected = (tokens as TokenRow[]).reduce(
      (acc: Record<string, PlatformInfo>, t: TokenRow) => {
        acc[t.platform] = {
          connected: true,
          username: t.platformUsername,
          isExpired: t.isExpired,
          expiresAt: t.expiresAt,
        };
        return acc;
      },
      {} as Record<string, PlatformInfo>
    );

    const result = SUPPORTED_PLATFORMS.map((p) => ({
      platform: p,
      ...(connected[p] ?? { connected: false, username: null, isExpired: false, expiresAt: null }),
    }));

    res.json({ data: result, success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/platforms/:platform — disconnect a platform
platformsRouter.delete('/:platform', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const platform = req.params.platform as PlatformName;
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      return next(createError('Unsupported platform', 400, 'INVALID_PLATFORM'));
    }

    const token = await prisma.platformToken.findFirst({
      where: { userId: req.userId!, platform },
    });
    if (!token) return next(createError('Platform not connected', 404, 'NOT_CONNECTED'));

    await prisma.platformToken.delete({ where: { id: token.id } });
    res.json({ data: { platform }, success: true });
  } catch (err) {
    next(err);
  }
});

// OAuth callback routes are handled in /api/auth/callback/:platform
// They are registered separately in the main router with their own logic
