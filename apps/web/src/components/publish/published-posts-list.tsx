'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { RefreshCw, ExternalLink, Send, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

interface PublishJobWithAd {
  id: string;
  platform: string;
  caption: string;
  hashtags: string[];
  status: 'pending' | 'processing' | 'published' | 'failed';
  publishedAt: string | null;
  postId: string | null;
  errorMessage: string | null;
  createdAt: string;
  ad: {
    id: string;
    generatedVideoUrl: string | null;
    rawPrompt: string;
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  snapchat: 'Snapchat',
};

const PLATFORM_COLORS: Record<string, string> = {
  tiktok: 'bg-black text-white',
  youtube: 'bg-red-600 text-white',
  instagram: 'bg-pink-600 text-white',
  facebook: 'bg-blue-600 text-white',
  snapchat: 'bg-yellow-400 text-black',
};

const STATUS_CONFIG: Record<string, { icon: React.ElementType; label: string; className: string }> =
  {
    pending: { icon: Clock, label: 'Pending', className: 'text-yellow-500' },
    processing: { icon: Loader2, label: 'Processing', className: 'text-blue-500 animate-spin' },
    published: { icon: CheckCircle2, label: 'Published', className: 'text-green-500' },
    failed: { icon: XCircle, label: 'Failed', className: 'text-red-500' },
  };

const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const fetcher = (url: string, token: string) =>
  fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

function buildPostUrl(platform: string, postId: string | null): string | null {
  if (!postId) return null;
  switch (platform) {
    case 'tiktok':
      return `https://www.tiktok.com/@user/video/${postId}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${postId}`;
    case 'instagram':
      return `https://www.instagram.com/p/${postId}`;
    case 'facebook':
      return `https://www.facebook.com/${postId}`;
    default:
      return null;
  }
}

export function PublishedPostsList() {
  const { data: session } = useSession();
  const token = session?.accessToken as string | undefined;

  const { data, mutate } = useSWR<{ data: PublishJobWithAd[]; success: boolean }>(
    token ? `${NEXT_PUBLIC_API_URL}/api/publish` : null,
    (url: string) => fetcher(url, token!),
    {
      refreshInterval: (d) => {
        const jobs = d?.data ?? [];
        const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'processing');
        return hasActive ? 5000 : 30000;
      },
    }
  );

  const jobs = data?.data ?? [];

  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = jobs.filter((j) => {
    if (platformFilter !== 'all' && j.platform !== platformFilter) return false;
    if (statusFilter !== 'all' && j.status !== statusFilter) return false;
    return true;
  });

  async function handleRetry(id: string) {
    await fetch(`${NEXT_PUBLIC_API_URL}/api/publish/${id}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    mutate();
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={Send}
        title="No published posts"
        description="Generate an ad and publish it to a connected social platform."
        action={{ label: 'Create an Ad', href: '/dashboard/ads/new' }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="all">All Platforms</option>
          {Object.entries(PLATFORM_LABELS).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="published">Published</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ad</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Platform</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">
                Caption
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">
                Published
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No posts match the selected filters.
                </td>
              </tr>
            ) : (
              filtered.map((job) => {
                const statusCfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
                const StatusIcon = statusCfg.icon;
                const postUrl = buildPostUrl(job.platform, job.postId);

                return (
                  <tr key={job.id} className="hover:bg-muted/30 transition-colors">
                    {/* Ad thumbnail */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {job.ad.generatedVideoUrl ? (
                          <video
                            src={job.ad.generatedVideoUrl}
                            className="h-10 w-10 rounded object-cover"
                            muted
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                            <Send className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <Link
                          href={`/dashboard/ads`}
                          className="text-xs text-muted-foreground hover:underline hidden sm:block max-w-[100px] truncate"
                        >
                          {job.ad.rawPrompt}
                        </Link>
                      </div>
                    </td>

                    {/* Platform */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${PLATFORM_COLORS[job.platform] ?? 'bg-muted text-foreground'}`}
                      >
                        {PLATFORM_LABELS[job.platform] ?? job.platform}
                      </span>
                    </td>

                    {/* Caption */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="max-w-[200px] truncate text-muted-foreground">{job.caption}</p>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon className={`h-4 w-4 ${statusCfg.className}`} />
                        <span className="capitalize">{statusCfg.label}</span>
                      </div>
                      {job.status === 'failed' && job.errorMessage && (
                        <p
                          className="mt-0.5 text-xs text-red-500 max-w-[140px] truncate"
                          title={job.errorMessage}
                        >
                          {job.errorMessage}
                        </p>
                      )}
                    </td>

                    {/* Published date */}
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">
                      {job.publishedAt ? new Date(job.publishedAt).toLocaleDateString() : '—'}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {postUrl && (
                          <a
                            href={postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            View
                          </a>
                        )}
                        {job.status === 'failed' && (
                          <button
                            onClick={() => handleRetry(job.id)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80 transition-colors"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
