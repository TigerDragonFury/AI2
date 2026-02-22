import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { PLATFORM_OAUTH } from '@adavatar/config';
import type { PlatformName } from '@adavatar/types';

export const oauthRouter = Router();

// ─── Platform credentials from env ───────────────────────────────────────────

const CREDS: Record<PlatformName, { clientId: string; clientSecret: string }> = {
  tiktok: {
    clientId: process.env.TIKTOK_CLIENT_ID!,
    clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
  },
  youtube: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },
  instagram: { clientId: process.env.META_APP_ID!, clientSecret: process.env.META_APP_SECRET! },
  facebook: { clientId: process.env.META_APP_ID!, clientSecret: process.env.META_APP_SECRET! },
  snapchat: {
    clientId: process.env.SNAPCHAT_CLIENT_ID!,
    clientSecret: process.env.SNAPCHAT_CLIENT_SECRET!,
  },
};

const SUPPORTED: PlatformName[] = ['tiktok', 'youtube', 'instagram', 'facebook', 'snapchat'];

function callbackUrl(platform: PlatformName) {
  return `${process.env.API_BASE_URL}/api/oauth/callback/${platform}`;
}

// ─── GET /api/oauth/connect/:platform ────────────────────────────────────────
// Generates the platform OAuth URL and redirects the user

oauthRouter.get(
  '/connect/:platform',
  requireAuth,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const platform = req.params.platform as PlatformName;
      if (!SUPPORTED.includes(platform))
        return next(createError('Unsupported platform', 400, 'INVALID_PLATFORM'));

      const { clientId } = CREDS[platform];
      if (!clientId)
        return next(createError(`${platform} OAuth not configured`, 500, 'OAUTH_NOT_CONFIGURED'));

      // Encode userId + platform in state JWT to verify on callback
      const state = jwt.sign(
        { userId: req.userId!, platform, iat: Date.now() },
        process.env.API_JWT_SECRET!,
        { expiresIn: '10m' }
      );

      const config = PLATFORM_OAUTH[platform];
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl(platform),
        scope: config.scope,
        response_type: 'code',
        state,
        ...(platform === 'tiktok' && { client_key: clientId }),
        ...(platform === 'youtube' && { access_type: 'offline', prompt: 'consent' }),
      });

      res.redirect(`${config.authUrl}?${params.toString()}`);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/oauth/callback/:platform ───────────────────────────────────────
// Receives the OAuth code, exchanges it for tokens, saves to DB

oauthRouter.get('/callback/:platform', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const platform = req.params.platform as PlatformName;
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      return res.redirect(
        `${process.env.WEB_BASE_URL}/dashboard/platforms?error=${encodeURIComponent(error)}`
      );
    }

    if (!code || !state) {
      return res.redirect(`${process.env.WEB_BASE_URL}/dashboard/platforms?error=missing_params`);
    }

    // Verify state JWT
    let payload: { userId: string; platform: string };
    try {
      payload = jwt.verify(state, process.env.API_JWT_SECRET!) as {
        userId: string;
        platform: string;
      };
    } catch {
      return res.redirect(`${process.env.WEB_BASE_URL}/dashboard/platforms?error=invalid_state`);
    }

    if (payload.platform !== platform) {
      return res.redirect(
        `${process.env.WEB_BASE_URL}/dashboard/platforms?error=platform_mismatch`
      );
    }

    const userId = payload.userId;
    const { clientId, clientSecret } = CREDS[platform];
    const config = PLATFORM_OAUTH[platform];

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl(platform),
      grant_type: 'authorization_code',
      ...(platform === 'tiktok' && { client_key: clientId }),
    });

    const tokenRes = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error(`[oauth] Token exchange failed for ${platform}:`, errText);
      return res.redirect(
        `${process.env.WEB_BASE_URL}/dashboard/platforms?error=token_exchange_failed`
      );
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string; // TikTok
      token_type?: string;
    };

    // Get platform user info
    const { platformUserId, platformUsername } = await getPlatformUser(
      platform,
      tokenJson.access_token,
      tokenJson.open_id
    );

    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000)
      : null;

    // Upsert platform token
    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform } },
      create: {
        userId,
        platform,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? null,
        expiresAt,
        platformUserId,
        platformUsername,
        isExpired: false,
      },
      update: {
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? null,
        expiresAt,
        platformUserId,
        platformUsername,
        isExpired: false,
      },
    });

    res.redirect(`${process.env.WEB_BASE_URL}/dashboard/platforms?success=${platform}`);
  } catch (err) {
    console.error('[oauth] Callback error:', err);
    res.redirect(`${process.env.WEB_BASE_URL}/dashboard/platforms?error=server_error`);
  }
});

// ─── Helper: get platform user info ──────────────────────────────────────────

async function getPlatformUser(
  platform: PlatformName,
  accessToken: string,
  tikTokOpenId?: string
): Promise<{ platformUserId: string; platformUsername: string }> {
  try {
    switch (platform) {
      case 'tiktok': {
        const r = await fetch(
          'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        const j = (await r.json()) as {
          data?: { user?: { open_id: string; display_name: string } };
        };
        return {
          platformUserId: j.data?.user?.open_id ?? tikTokOpenId ?? 'unknown',
          platformUsername: j.data?.user?.display_name ?? 'TikTok User',
        };
      }

      case 'youtube': {
        const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const j = (await r.json()) as { id: string; name: string };
        return { platformUserId: j.id, platformUsername: j.name };
      }

      case 'instagram': {
        const r = await fetch(
          `https://graph.instagram.com/me?fields=id,username&access_token=${accessToken}`
        );
        const j = (await r.json()) as { id: string; username: string };
        return { platformUserId: j.id, platformUsername: j.username };
      }

      case 'facebook': {
        const r = await fetch(
          `https://graph.facebook.com/me?fields=id,name&access_token=${accessToken}`
        );
        const j = (await r.json()) as { id: string; name: string };
        return { platformUserId: j.id, platformUsername: j.name };
      }

      case 'snapchat': {
        const r = await fetch('https://kit.snapchat.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const j = (await r.json()) as { sub: string; displayName?: string };
        return { platformUserId: j.sub, platformUsername: j.displayName ?? 'Snapchat User' };
      }

      default:
        return { platformUserId: 'unknown', platformUsername: 'Unknown' };
    }
  } catch {
    return { platformUserId: 'unknown', platformUsername: 'Unknown' };
  }
}
