'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
  Trash2,
  RefreshCw,
  Play,
  Sparkles,
} from 'lucide-react';
import type { Ad } from '@adavatar/types';

type AdWithRefs = Ad & {
  avatar?: { id: string; name: string; avatarVideoUrl: string | null };
  product?: { id: string; name: string; imageUrls: string[] };
};

// ─── SWR fetcher ─────────────────────────────────────────────────────────────

function buildFetcher(token: string) {
  return (url: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => j.data as AdWithRefs[]);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const ASPECT_LABELS: Record<string, string> = {
  RATIO_9_16: '9:16',
  RATIO_16_9: '16:9',
  RATIO_1_1: '1:1',
};

function StatusBadge({ status }: { status: Ad['status'] }) {
  const map: Record<Ad['status'], { label: string; classes: string; icon: React.ReactNode }> = {
    pending: {
      label: 'Pending',
      classes: 'bg-yellow-500/10 text-yellow-600',
      icon: <Clock className="h-3 w-3" />,
    },
    processing: {
      label: 'Generating',
      classes: 'bg-blue-500/10 text-blue-600',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    ready: {
      label: 'Ready',
      classes: 'bg-green-500/10 text-green-600',
      icon: <CheckCircle className="h-3 w-3" />,
    },
    failed: {
      label: 'Failed',
      classes: 'bg-destructive/10 text-destructive',
      icon: <AlertCircle className="h-3 w-3" />,
    },
  };
  const { label, classes, icon } = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {icon} {label}
    </span>
  );
}

// ─── Ad card ─────────────────────────────────────────────────────────────────

function AdCard({
  ad,
  onDelete,
  onRegenerate,
}: {
  ad: AdWithRefs;
  onDelete: (id: string) => void;
  onRegenerate: (id: string, prompt: string) => void;
}) {
  const [showRegen, setShowRegen] = useState(false);
  const [newPrompt, setNewPrompt] = useState(ad.rawPrompt);
  const [regenLoading, setRegenLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const thumb = ad.product?.imageUrls?.[0];
  const ratio = ASPECT_LABELS[ad.aspectRatio as string] ?? ad.aspectRatio;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      {/* Video / Thumbnail */}
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted">
        {ad.generatedVideoUrl ? (
          <video
            src={ad.generatedVideoUrl}
            className="h-full w-full object-cover"
            muted
            loop
            playsInline
            controls
          />
        ) : thumb ? (
          <img src={thumb} alt="Product" className="h-full w-full object-cover opacity-40" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
            <Sparkles className="h-8 w-8" />
            <span className="text-xs">Generating…</span>
          </div>
        )}

        {/* Aspect ratio badge */}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white">
          {ratio}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {ad.avatar?.name ? `Avatar: ${ad.avatar.name}` : '—'} · {ad.product?.name ?? '—'}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-foreground">{ad.rawPrompt}</p>
          </div>
          <StatusBadge status={ad.status} />
        </div>

        {ad.status === 'failed' && ad.errorMessage && (
          <p className="text-xs text-destructive">{ad.errorMessage}</p>
        )}

        {/* Actions */}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              onDelete(ad.id);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            {deleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Delete
          </button>

          {(ad.status === 'ready' || ad.status === 'failed') && (
            <button
              type="button"
              onClick={() => setShowRegen((p) => !p)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </button>
          )}

          {ad.status === 'ready' && ad.generatedVideoUrl && (
            <Link
              href={`/dashboard/ads/${ad.id}/publish`}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Play className="h-3 w-3" /> Publish
            </Link>
          )}
        </div>

        {/* Regenerate prompt */}
        {showRegen && (
          <div className="mt-2 space-y-2 rounded-md border border-border p-3">
            <textarea
              rows={3}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              disabled={newPrompt.length < 10 || regenLoading}
              onClick={async () => {
                setRegenLoading(true);
                await onRegenerate(ad.id, newPrompt);
                setShowRegen(false);
                setRegenLoading(false);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {regenLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Start Regeneration
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main gallery ─────────────────────────────────────────────────────────────

export function AdGallery() {
  const { data: session } = useSession();

  const {
    data: ads,
    mutate,
    isLoading,
  } = useSWR(
    session?.accessToken
      ? [`${process.env.NEXT_PUBLIC_API_URL}/api/ads`, session.accessToken]
      : null,
    ([url, token]) => buildFetcher(token as string)(url),
    {
      refreshInterval: (data) => {
        const hasActive = data?.some((a) => a.status === 'pending' || a.status === 'processing');
        return hasActive ? 10_000 : 60_000;
      },
    }
  );

  const handleDelete = async (id: string) => {
    if (!session?.accessToken) return;
    await mutate(
      async (prev) => {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ads/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        return prev?.filter((a) => a.id !== id);
      },
      { revalidate: false }
    );
  };

  const handleRegenerate = async (id: string, rawPrompt: string) => {
    if (!session?.accessToken) return;
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ads/${id}/regenerate`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawPrompt }),
    });
    await mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ads?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
        <Sparkles className="mb-4 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No ads yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create your first AI-generated video ad.
        </p>
        <Link
          href="/dashboard/ads/new"
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create Ad
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {ads.map((ad) => (
        <AdCard key={ad.id} ad={ad} onDelete={handleDelete} onRegenerate={handleRegenerate} />
      ))}
    </div>
  );
}
