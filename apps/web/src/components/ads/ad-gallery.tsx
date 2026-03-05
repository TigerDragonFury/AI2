'use client';

import { useState, useEffect, useRef } from 'react';
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
  ChevronLeft,
  ChevronRight,
  X,
  Download,
} from 'lucide-react';
import type { Ad } from '@adavatar/types';

const PAGE_SIZE = 10;

type AdWithRefs = Ad & {
  avatar?: { id: string; name: string; avatarVideoUrl: string | null };
  product?: { id: string; name: string; imageUrls: string[] };
};

type PaginatedResponse = {
  data: AdWithRefs[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

// --- Fetcher ------------------------------------------------------------------

function buildFetcher(token: string) {
  return (url: string): Promise<PaginatedResponse> =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
}

// --- Helpers ------------------------------------------------------------------

const ASPECT_LABELS: Record<string, string> = {
  RATIO_9_16: '9:16',
  RATIO_16_9: '16:9',
  RATIO_1_1: '1:1',
};

function fmt(date: string | Date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// --- Status badge -------------------------------------------------------------

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

// --- Video modal --------------------------------------------------------------

function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -right-3 -top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
        <video
          ref={videoRef}
          src={url}
          controls
          autoPlay
          playsInline
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          style={{ minWidth: 280 }}
        />
        <a
          href={url}
          download
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-black/50 px-2.5 py-1.5 text-xs text-white hover:bg-black/70"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-3 w-3" /> Download
        </a>
      </div>
    </div>
  );
}

// --- Thumbnail ----------------------------------------------------------------

function Thumbnail({ ad, onPlay }: { ad: AdWithRefs; onPlay: () => void }) {
  const thumb = ad.product?.imageUrls?.[0];
  const hasVideo = !!ad.generatedVideoUrl;

  return (
    <button
      type="button"
      onClick={hasVideo ? onPlay : undefined}
      className={`group relative flex h-[90px] w-[160px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${
        hasVideo ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      {thumb ? (
        <img src={thumb} alt="Thumbnail" className="h-full w-full object-cover" />
      ) : (
        <Sparkles className="h-6 w-6 text-muted-foreground/30" />
      )}

      {hasVideo && (
        <div className="absolute inset-0 bg-black/30 opacity-0 transition-opacity group-hover:opacity-100" />
      )}

      <div className="absolute inset-0 flex items-center justify-center">
        {hasVideo ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm ring-1 ring-white/30 transition-transform group-hover:scale-110">
            <Play className="h-5 w-5 fill-white text-white" />
          </div>
        ) : ad.status === 'processing' ? (
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        ) : ad.status === 'pending' ? (
          <Clock className="h-5 w-5 text-white/60" />
        ) : ad.status === 'failed' ? (
          <AlertCircle className="h-5 w-5 text-destructive/80" />
        ) : null}
      </div>

      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        {ASPECT_LABELS[ad.aspectRatio as string] ?? ad.aspectRatio}
      </span>
    </button>
  );
}

// --- Ad row ------------------------------------------------------------------

function AdRow({
  ad,
  onDelete,
  onRegenerate,
}: {
  ad: AdWithRefs;
  onDelete: (id: string) => void;
  onRegenerate: (id: string, prompt: string) => void;
}) {
  const [videoOpen, setVideoOpen] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const [newPrompt, setNewPrompt] = useState(ad.rawPrompt);
  const [regenLoading, setRegenLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {videoOpen && ad.generatedVideoUrl && (
        <VideoModal url={ad.generatedVideoUrl} onClose={() => setVideoOpen(false)} />
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-start">
        <Thumbnail ad={ad} onPlay={() => setVideoOpen(true)} />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {ad.product?.name ?? 'Ad'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ad.avatar?.name ? `Avatar: ${ad.avatar.name}` : 'No avatar'} &middot;{' '}
                {ad.duration ? `${ad.duration}s` : ''} &middot; {fmt(ad.createdAt)}
              </p>
            </div>
            <StatusBadge status={ad.status} />
          </div>

          <p className="line-clamp-2 text-xs text-muted-foreground">{ad.rawPrompt}</p>

          {ad.status === 'failed' && ad.errorMessage && (
            <p className="text-xs text-destructive">{ad.errorMessage}</p>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                onDelete(ad.id);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
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
              <>
                <button
                  type="button"
                  onClick={() => setVideoOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  <Play className="h-3 w-3" /> Preview
                </button>
                <Link
                  href={`/dashboard/ads/${ad.id}/publish`}
                  className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Publish
                </Link>
              </>
            )}
          </div>

          {showRegen && (
            <div className="mt-1 space-y-2 rounded-md border border-border p-3">
              <textarea
                rows={2}
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
    </>
  );
}

// --- Pagination ---------------------------------------------------------------

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const add = new Set<number>();
  [1, page - 1, page, page + 1, totalPages].forEach((n) => {
    if (n >= 1 && n <= totalPages) add.add(n);
  });
  const sorted = [...add].sort((a, b) => a - b);
  const pages: (number | string)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) pages.push('ellipsis-' + i);
    pages.push(n);
  });

  return (
    <div className="flex items-center justify-center gap-1 pt-4">
      <button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-sm hover:bg-muted disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((p) =>
        typeof p === 'string' ? (
          <span
            key={p}
            className="flex h-8 w-8 items-center justify-center text-sm text-muted-foreground"
          >
            &hellip;
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm ${
              p === page
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-muted'
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-sm hover:bg-muted disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// --- Main gallery -------------------------------------------------------------

export function AdGallery() {
  const { data: session } = useSession();
  const [page, setPage] = useState(1);

  const {
    data: response,
    mutate,
    isLoading,
  } = useSWR(
    session?.accessToken
      ? [
          `${process.env.NEXT_PUBLIC_API_URL}/api/ads?page=${page}&limit=${PAGE_SIZE}`,
          session.accessToken,
        ]
      : null,
    ([url, token]) => buildFetcher(token as string)(url),
    {
      refreshInterval: (data) => {
        const hasActive = data?.data?.some(
          (a) => a.status === 'pending' || a.status === 'processing'
        );
        return hasActive ? 10_000 : 60_000;
      },
      keepPreviousData: true,
    }
  );

  useEffect(() => {
    if (
      response?.pagination &&
      page > response.pagination.totalPages &&
      response.pagination.totalPages > 0
    ) {
      setPage(response.pagination.totalPages);
    }
  }, [response, page]);

  const handleDelete = async (id: string) => {
    if (!session?.accessToken) return;
    await mutate(
      async (prev) => {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ads/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        return prev
          ? {
              ...prev,
              data: prev.data.filter((a) => a.id !== id),
              pagination: { ...prev.pagination, total: prev.pagination.total - 1 },
            }
          : prev;
      },
      { revalidate: true }
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

  if (isLoading && !response) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ads = response?.data ?? [];
  const pagination = response?.pagination;

  if (!isLoading && ads.length === 0 && page === 1) {
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
    <div className="space-y-3">
      {pagination && (
        <p className="text-xs text-muted-foreground">
          {pagination.total} ad{pagination.total !== 1 ? 's' : ''} &middot; page {pagination.page}{' '}
          of {pagination.totalPages}
        </p>
      )}

      <div className={`space-y-3 transition-opacity ${isLoading ? 'opacity-60' : 'opacity-100'}`}>
        {ads.map((ad) => (
          <AdRow key={ad.id} ad={ad} onDelete={handleDelete} onRegenerate={handleRegenerate} />
        ))}
      </div>

      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPage={(p) => {
            setPage(p);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
    </div>
  );
}
