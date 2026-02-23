import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { PLATFORM_OAUTH } from '@adavatar/config';
import jwt from 'jsonwebtoken';
import type { PlatformName } from '@adavatar/types';

const SUPPORTED: PlatformName[] = ['tiktok', 'youtube', 'instagram', 'facebook', 'snapchat'];

const CREDS: Record<PlatformName, { clientId: string }> = {
  tiktok: { clientId: process.env.TIKTOK_CLIENT_ID! },
  youtube: { clientId: process.env.GOOGLE_CLIENT_ID! },
  instagram: { clientId: process.env.META_APP_ID! },
  facebook: { clientId: process.env.META_APP_ID! },
  snapchat: { clientId: process.env.SNAPCHAT_CLIENT_ID! },
};

const CALLBACK_BASE = process.env.API_BASE_URL ?? 'https://adavatar-api.onrender.com';

export async function GET(_req: Request, { params }: { params: { platform: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const platform = params.platform as PlatformName;
  if (!SUPPORTED.includes(platform)) redirect('/dashboard/platforms?error=unsupported_platform');

  const { clientId } = CREDS[platform];
  if (!clientId) redirect('/dashboard/platforms?error=not_configured');

  // Build state JWT (signed) so the callback can identify the user
  const state = jwt.sign({ userId: session.user.id, platform }, process.env.API_JWT_SECRET!, {
    expiresIn: '10m',
  });

  const config = PLATFORM_OAUTH[platform];
  const callbackUrl = `${CALLBACK_BASE}/api/oauth/callback/${platform}`;

  const params2 = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: config.scope,
    response_type: 'code',
    state,
    ...(platform === 'tiktok' && { client_key: clientId }),
    ...(platform === 'youtube' && { access_type: 'offline', prompt: 'consent' }),
  });

  redirect(`${config.authUrl}?${params2.toString()}`);
}
