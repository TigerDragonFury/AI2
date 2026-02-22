'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle,
  Users,
  Package,
  Sparkles,
} from 'lucide-react';
import type { Avatar, Product, AspectRatio } from '@adavatar/types';

// ─── SWR helpers ──────────────────────────────────────────────────────────────

function fetcher<T>(url: string, token: string): Promise<T[]> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((j) => j.data as T[]);
}

// ─── Step indicators ──────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Choose Avatar', icon: Users },
  { label: 'Choose Product', icon: Package },
  { label: 'Write Prompt', icon: Sparkles },
];

function StepBar({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={i} className="flex flex-1 items-center gap-2">
            <div
              className={[
                'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done
                  ? 'bg-primary text-primary-foreground'
                  : active
                    ? 'border-2 border-primary text-primary'
                    : 'border-2 border-muted text-muted-foreground',
              ].join(' ')}
            >
              {done ? <CheckCircle className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={`hidden text-sm sm:block ${active ? 'font-medium' : 'text-muted-foreground'}`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Avatar picker ─────────────────────────────────────────────────────

function AvatarPicker({
  token,
  selected,
  onSelect,
}: {
  token: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = useSWR(
    token ? `${process.env.NEXT_PUBLIC_API_URL}/api/avatars` : null,
    (url) => fetcher<Avatar>(url, token)
  );

  const ready = data?.filter((a) => a.status === 'ready') ?? [];

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (!ready.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
        <Users className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No ready avatars</p>
        <p className="mt-1 text-xs text-muted-foreground">Upload and process an avatar first.</p>
        <a href="/dashboard/avatars/new" className="mt-3 text-xs text-primary hover:underline">
          Upload Avatar →
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {ready.map((avatar) => (
        <button
          key={avatar.id}
          type="button"
          onClick={() => onSelect(avatar.id)}
          className={[
            'group relative overflow-hidden rounded-lg border-2 transition-all',
            selected === avatar.id
              ? 'border-primary shadow-md'
              : 'border-transparent hover:border-primary/40',
          ].join(' ')}
        >
          <div className="aspect-square overflow-hidden bg-muted">
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
            ) : (
              <div className="flex h-full items-center justify-center">
                <Users className="h-8 w-8 text-muted-foreground/30" />
              </div>
            )}
          </div>
          <div className="p-2 text-left">
            <p className="truncate text-xs font-medium">{avatar.name}</p>
          </div>
          {selected === avatar.id && (
            <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <CheckCircle className="h-3 w-3" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Step 2: Product picker ────────────────────────────────────────────────────

function ProductPicker({
  token,
  selected,
  onSelect,
}: {
  token: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = useSWR(
    token ? `${process.env.NEXT_PUBLIC_API_URL}/api/products` : null,
    (url) => fetcher<Product>(url, token)
  );

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (!data?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
        <Package className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No products yet</p>
        <a href="/dashboard/products/new" className="mt-3 text-xs text-primary hover:underline">
          Add Product →
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onSelect(product.id)}
          className={[
            'group relative overflow-hidden rounded-lg border-2 transition-all',
            selected === product.id
              ? 'border-primary shadow-md'
              : 'border-transparent hover:border-primary/40',
          ].join(' ')}
        >
          <div className="aspect-square overflow-hidden bg-muted">
            {product.imageUrls[0] ? (
              <img
                src={product.imageUrls[0]}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Package className="h-8 w-8 text-muted-foreground/30" />
              </div>
            )}
          </div>
          <div className="p-2 text-left">
            <p className="truncate text-xs font-medium">{product.name}</p>
          </div>
          {selected === product.id && (
            <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <CheckCircle className="h-3 w-3" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Step 3: Prompt & aspect ratio ────────────────────────────────────────────

const ASPECT_RATIOS: { value: AspectRatio; label: string; description: string }[] = [
  { value: '9:16', label: '9:16', description: 'Portrait (TikTok, Reels)' },
  { value: '16:9', label: '16:9', description: 'Landscape (YouTube)' },
  { value: '1:1', label: '1:1', description: 'Square (Feed)' },
];

function PromptStep({
  prompt,
  aspectRatio,
  onPromptChange,
  onAspectChange,
}: {
  prompt: string;
  aspectRatio: AspectRatio;
  onPromptChange: (v: string) => void;
  onAspectChange: (v: AspectRatio) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Prompt */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium">
          Ad Prompt <span className="text-destructive">*</span>
        </label>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={5}
          minLength={10}
          maxLength={1000}
          placeholder="Describe the ad you want to generate. E.g. 'A short video showing the product being used at the gym with energetic music...'"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-right text-xs text-muted-foreground">{prompt.length}/1000</p>
      </div>

      {/* Aspect ratio */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Aspect Ratio</label>
        <div className="grid grid-cols-3 gap-3">
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar.value}
              type="button"
              onClick={() => onAspectChange(ar.value)}
              className={[
                'flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition-all',
                aspectRatio === ar.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40',
              ].join(' ')}
            >
              <span className="text-sm font-semibold">{ar.label}</span>
              <span className="text-xs text-muted-foreground">{ar.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function AdCreatorWizard() {
  const router = useRouter();
  const { data: session } = useSession();
  const [step, setStep] = useState(0);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = session?.accessToken as string | undefined;

  const canNext = [!!avatarId, !!productId, prompt.length >= 10][step];

  const handleSubmit = async () => {
    if (!token || !avatarId || !productId || prompt.length < 10) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ads/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId, productId, rawPrompt: prompt, aspectRatio }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to create ad');
        setIsSubmitting(false);
        return;
      }
      router.push('/dashboard/ads');
    } catch {
      setError('Network error. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <StepBar current={step} />

      <div className="min-h-[320px]">
        {step === 0 && token && (
          <AvatarPicker token={token} selected={avatarId} onSelect={setAvatarId} />
        )}
        {step === 1 && token && (
          <ProductPicker token={token} selected={productId} onSelect={setProductId} />
        )}
        {step === 2 && (
          <PromptStep
            prompt={prompt}
            aspectRatio={aspectRatio}
            onPromptChange={setPrompt}
            onAspectChange={setAspectRatio}
          />
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </p>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canNext || isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Generate Ad
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
