'use client';

import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, AlertCircle, Link2, Link2Off } from 'lucide-react';

type PlatformStatus = {
  platform: string;
  connected: boolean;
  username: string | null;
  isExpired: boolean;
  expiresAt: string | null;
};

const PLATFORM_META: Record<string, { name: string; description: string; color: string }> = {
  tiktok: { name: 'TikTok', description: 'Short-form video (9:16)', color: 'bg-black' },
  youtube: { name: 'YouTube', description: 'Shorts & long-form (16:9)', color: 'bg-red-600' },
  instagram: {
    name: 'Instagram',
    description: 'Reels & Feed (9:16, 1:1)',
    color: 'bg-gradient-to-br from-purple-600 to-pink-500',
  },
  facebook: { name: 'Facebook', description: 'Page videos', color: 'bg-blue-600' },
  snapchat: {
    name: 'Snapchat',
    description: 'Snap Ads (Business account)',
    color: 'bg-yellow-400',
  },
};

function PlatformInitial({ platform }: { platform: string }) {
  const meta = PLATFORM_META[platform];
  return (
    <div
      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${meta?.color ?? 'bg-muted'}`}
    >
      {meta?.name?.[0] ?? '?'}
    </div>
  );
}

function buildFetcher(token: string) {
  return (url: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => j.data as PlatformStatus[]);
}

export function PlatformConnectList() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const successPlatform = searchParams.get('success');
  const errorMsg = searchParams.get('error');
  const token = session?.accessToken as string | undefined;

  const {
    data: platforms,
    isLoading,
    mutate,
  } = useSWR(
    token ? `${process.env.NEXT_PUBLIC_API_URL}/api/platforms` : null,
    buildFetcher(token!),
    { refreshInterval: 30000 }
  );

  const handleDisconnect = async (platform: string) => {
    if (!token) return;
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/platforms/${platform}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    await mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Feedback banners */}
      {successPlatform && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-600">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {PLATFORM_META[successPlatform]?.name ?? successPlatform} connected successfully!
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Connection failed: {errorMsg.replace(/_/g, ' ')}
        </div>
      )}

      {/* Platform cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(platforms ?? []).map((p) => {
          const meta = PLATFORM_META[p.platform];
          return (
            <div
              key={p.platform}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <PlatformInitial platform={p.platform} />
                <div className="min-w-0">
                  <p className="font-medium">{meta?.name ?? p.platform}</p>
                  {p.connected && p.username ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">@{p.username}</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta?.description}</p>
                  )}
                  {p.connected && p.isExpired && (
                    <p className="mt-0.5 text-xs text-destructive">Token expired — reconnect</p>
                  )}
                </div>
              </div>

              <div className="ml-3 flex-shrink-0">
                {p.connected ? (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(p.platform)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
                  >
                    <Link2Off className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                ) : (
                  <a
                    href={`/api/oauth/connect/${p.platform}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Connect
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
