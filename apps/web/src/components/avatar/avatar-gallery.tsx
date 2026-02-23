'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Users, Trash2, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import type { Avatar } from '@adavatar/types';

// ─── Fetcher ──────────────────────────────────────────────────────────────────

function buildFetcher(token: string) {
  return (url: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => j.data as Avatar[]);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Avatar['status'] }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
        <CheckCircle className="h-3 w-3" /> Ready
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <AlertCircle className="h-3 w-3" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-600">
      <Loader2 className="h-3 w-3 animate-spin" /> Processing
    </span>
  );
}

// ─── Avatar card ──────────────────────────────────────────────────────────────

function AvatarCard({ avatar, onDelete }: { avatar: Avatar; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Thumbnail area */}
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted">
        {avatar.avatarVideoUrl ? (
          <video
            src={avatar.avatarVideoUrl}
            className="h-full w-full object-cover"
            muted
            loop
            playsInline
            onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
            onMouseLeave={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : avatar.status === 'failed' ? (
          <AlertCircle className="h-10 w-10 text-destructive/40" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Processing…</span>
          </div>
        )}

        {/* Delete button */}
        <button
          type="button"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            onDelete(avatar.id);
          }}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
          aria-label="Delete avatar"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5 p-3">
        <p className="truncate text-sm font-medium">{avatar.name}</p>
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={avatar.status} />
          <span className="text-xs text-muted-foreground">
            {avatar.inputType === 'video' ? '🎬 Video' : '🖼 Image'}
          </span>
        </div>
        {avatar.status === 'failed' && avatar.errorMessage && (
          <p className="mt-1 text-xs text-destructive line-clamp-2">{avatar.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main gallery ─────────────────────────────────────────────────────────────

export function AvatarGallery() {
  const { data: session } = useSession();

  const {
    data: avatars,
    mutate,
    isLoading,
  } = useSWR(
    session?.accessToken
      ? [`${process.env.NEXT_PUBLIC_API_URL}/api/avatars`, session.accessToken]
      : null,
    ([url, token]) => buildFetcher(token as string)(url),
    {
      refreshInterval: (data) => {
        // Poll every 10 s while any avatar is still processing
        const hasProcessing = data?.some((a) => a.status === 'processing');
        return hasProcessing ? 10_000 : 60_000;
      },
    }
  );

  const handleDelete = async (id: string) => {
    if (!session?.accessToken) return;
    // Optimistic removal
    await mutate(
      async (prev) => {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/avatars/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        return prev?.filter((a) => a.id !== id);
      },
      { revalidate: false }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!avatars?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
        <Users className="mb-4 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No avatars yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload a photo or video to create your first AI avatar.
        </p>
        <Link
          href="/dashboard/avatars/new"
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Upload Avatar
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {avatars.map((avatar) => (
        <AvatarCard key={avatar.id} avatar={avatar} onDelete={handleDelete} />
      ))}
    </div>
  );
}
