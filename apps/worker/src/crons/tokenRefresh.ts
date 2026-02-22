import { prisma } from '../lib/prisma';
import { isExpiredSoon } from '@adavatar/utils';
import { TOKEN_REFRESH_THRESHOLD_HOURS, PLATFORM_OAUTH } from '@adavatar/config';
import { sendTokenExpiryEmail } from '../lib/email';

interface TokenRefreshResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function refreshToken(
  platform: string,
  refreshToken: string
): Promise<TokenRefreshResponse | null> {
  const config = PLATFORM_OAUTH[platform as keyof typeof PLATFORM_OAUTH];
  if (!config) return null;

  const clientId =
    platform === 'tiktok'
      ? process.env.TIKTOK_CLIENT_ID
      : platform === 'youtube'
        ? process.env.YOUTUBE_CLIENT_ID
        : platform === 'instagram' || platform === 'facebook'
          ? process.env.META_APP_ID
          : process.env.SNAPCHAT_CLIENT_ID;

  const clientSecret =
    platform === 'tiktok'
      ? process.env.TIKTOK_CLIENT_SECRET
      : platform === 'youtube'
        ? process.env.YOUTUBE_CLIENT_SECRET
        : platform === 'instagram' || platform === 'facebook'
          ? process.env.META_APP_SECRET
          : process.env.SNAPCHAT_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) return null;
  return response.json() as Promise<TokenRefreshResponse>;
}

export async function runTokenRefreshCron() {
  const tokens = await prisma.platformToken.findMany({
    where: {
      isExpired: false,
      expiresAt: { not: null },
    },
  });

  let refreshed = 0;
  let failed = 0;

  for (const token of tokens) {
    if (!token.expiresAt) continue;
    if (!isExpiredSoon(token.expiresAt, TOKEN_REFRESH_THRESHOLD_HOURS)) continue;
    if (!token.refreshToken) {
      await prisma.platformToken.update({
        where: { id: token.id },
        data: { isExpired: true },
      });
      await prisma.notification.create({
        data: {
          userId: token.userId,
          event: 'platform_token_expired',
          message: `Your ${token.platform} connection has expired. Please reconnect.`,
          metadata: { platform: token.platform },
        },
      });
      // Send expiry email
      const expUser = await prisma.user.findUnique({
        where: { id: token.userId },
        select: { email: true, name: true },
      });
      if (expUser?.email) {
        sendTokenExpiryEmail(expUser.email, expUser.name ?? '', token.platform).catch(
          console.error
        );
      }
      failed++;
      continue;
    }

    const refreshed_token = await refreshToken(token.platform, token.refreshToken).catch(
      () => null
    );

    if (!refreshed_token?.access_token) {
      await prisma.platformToken.update({
        where: { id: token.id },
        data: { isExpired: true },
      });
      await prisma.notification.create({
        data: {
          userId: token.userId,
          event: 'platform_token_expired',
          message: `Your ${token.platform} connection has expired. Please reconnect.`,
          metadata: { platform: token.platform },
        },
      });
      // Send expiry email
      const failUser = await prisma.user.findUnique({
        where: { id: token.userId },
        select: { email: true, name: true },
      });
      if (failUser?.email) {
        sendTokenExpiryEmail(failUser.email, failUser.name ?? '', token.platform).catch(
          console.error
        );
      }
      failed++;
      continue;
    }

    const newExpiresAt = refreshed_token.expires_in
      ? new Date(Date.now() + refreshed_token.expires_in * 1000)
      : null;

    await prisma.platformToken.update({
      where: { id: token.id },
      data: {
        accessToken: refreshed_token.access_token,
        refreshToken: refreshed_token.refresh_token ?? token.refreshToken,
        expiresAt: newExpiresAt,
        isExpired: false,
      },
    });

    refreshed++;
  }

  console.log(`[tokenRefreshCron] Refreshed: ${refreshed}, Failed: ${failed}`);
}
