'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Loader2, AlertCircle, CheckCircle, Send, Hash } from 'lucide-react';

type PlatformStatus = {
  platform: string;
  connected: boolean;
  username: string | null;
  isExpired: boolean;
};

const PLATFORM_NAMES: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  snapchat: 'Snapchat',
};

function fetcher<T>(url: string, token: string): Promise<T> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((j) => j.data);
}

interface PublishFormProps {
  adId: string;
  videoUrl: string | null;
}

export function PublishForm({ adId, videoUrl }: PublishFormProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.accessToken as string | undefined;

  const { data: platforms, isLoading } = useSWR<PlatformStatus[]>(
    token ? `${process.env.NEXT_PUBLIC_API_URL}/api/platforms` : null,
    (url: string) => fetcher<PlatformStatus[]>(url, token!)
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const connected = platforms?.filter((p) => p.connected && !p.isExpired) ?? [];

  const togglePlatform = (p: string) => {
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const addHashtag = () => {
    const tag = hashtagInput.trim().replace(/^#/, '');
    if (tag && !hashtags.includes(tag) && hashtags.length < 30) {
      setHashtags((prev) => [...prev, tag]);
    }
    setHashtagInput('');
  };

  const removeHashtag = (tag: string) => setHashtags((prev) => prev.filter((t) => t !== tag));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selected.length) return;
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = {
      adId,
      platforms: selected,
      caption,
      hashtags,
    };
    if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Publish failed');
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push('/dashboard/published'), 1500);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <CheckCircle className="h-10 w-10 text-green-500" />
        <p className="font-medium">Publish job submitted!</p>
        <p className="text-sm text-muted-foreground">Redirecting to published posts…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Video preview */}
      {videoUrl && (
        <video
          src={videoUrl}
          className="w-full max-h-64 rounded-lg object-contain bg-black"
          controls
          muted
        />
      )}

      {/* Platform selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Publish to <span className="text-destructive">*</span>
        </label>
        {connected.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            No platforms connected.{' '}
            <a href="/dashboard/platforms" className="text-primary hover:underline">
              Connect now →
            </a>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {connected.map((p) => (
              <button
                key={p.platform}
                type="button"
                onClick={() => togglePlatform(p.platform)}
                className={[
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                  selected.includes(p.platform)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:border-primary/50',
                ].join(' ')}
              >
                {selected.includes(p.platform) && <CheckCircle className="h-3 w-3" />}
                {PLATFORM_NAMES[p.platform] ?? p.platform}
                {p.username && <span className="opacity-60">@{p.username}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium">
          Caption <span className="text-destructive">*</span>
        </label>
        <textarea
          required
          rows={4}
          maxLength={2200}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption for your post…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-right text-xs text-muted-foreground">{caption.length}/2200</p>
      </div>

      {/* Hashtags */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Hashtags</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Hash className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={hashtagInput}
              onChange={(e) => setHashtagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addHashtag();
                }
              }}
              placeholder="hashtag"
              className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={addHashtag}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Add
          </button>
        </div>
        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {hashtags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => removeHashtag(tag)}
                  className="opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Schedule (optional) */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Schedule (optional)</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          min={new Date().toISOString().slice(0, 16)}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">Leave empty to publish immediately</p>
      </div>

      {/* Error */}
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!selected.length || !caption.trim() || submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" /> Publish Ad
          </>
        )}
      </button>
    </form>
  );
}
