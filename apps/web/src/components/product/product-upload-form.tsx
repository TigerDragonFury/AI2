'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { X, ImageIcon, AlertCircle, Loader2 } from 'lucide-react';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per image
const MAX_IMAGES = 10;

interface FileEntry {
  file: File;
  preview: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  url?: string;
  error?: string;
}

const CURRENCIES = ['USD', 'AED', 'SAR', 'EUR', 'GBP'] as const;

export function ProductUploadForm() {
  const router = useRouter();
  const { data: session } = useSession();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const valid = arr.filter((f) => {
      if (!ACCEPTED_TYPES.includes(f.type)) return false;
      if (f.size > MAX_BYTES) return false;
      return true;
    });
    const remaining = MAX_IMAGES - entries.length;
    setEntries((prev) => [
      ...prev,
      ...valid.slice(0, remaining).map((f) => ({
        file: f,
        preview: URL.createObjectURL(f),
        status: 'pending' as const,
        progress: 0,
      })),
    ]);
  };

  const removeEntry = (idx: number) => {
    setEntries((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }, []);

  const uploadOne = async (
    entry: FileEntry,
    token: string,
    onProgress: (p: number) => void
  ): Promise<string> => {
    // Get presign
    const ps = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/products/presign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!ps.ok) throw new Error('Failed to get upload credentials');
    const { data } = await ps.json();

    const formData = new FormData();
    formData.append('file', entry.file);
    formData.append('signature', data.signature);
    formData.append('timestamp', String(data.timestamp));
    formData.append('api_key', data.apiKey);
    formData.append('folder', data.folder);

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText).secure_url as string);
        } else {
          reject(new Error('Upload failed'));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Network error')));
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`);
      xhr.send(formData);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entries.length || !name.trim() || !session?.accessToken) return;
    setApiError(null);
    setIsSubmitting(true);

    const token = session.accessToken as string;
    const uploaded: string[] = [];

    // Upload all images sequentially (simple)
    for (let i = 0; i < entries.length; i++) {
      setEntries((prev) =>
        prev.map((en, idx) => (idx === i ? { ...en, status: 'uploading' } : en))
      );
      try {
        const url = await uploadOne(entries[i], token, (p) => {
          setEntries((prev) => prev.map((en, idx) => (idx === i ? { ...en, progress: p } : en)));
        });
        uploaded.push(url);
        setEntries((prev) =>
          prev.map((en, idx) => (idx === i ? { ...en, status: 'done', url, progress: 100 } : en))
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setEntries((prev) =>
          prev.map((en, idx) => (idx === i ? { ...en, status: 'error', error: msg } : en))
        );
        setApiError('One or more images failed to upload.');
        setIsSubmitting(false);
        return;
      }
    }

    // Create product record
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          imageUrls: uploaded,
          description: description.trim() || undefined,
          price: price ? parseFloat(price) : undefined,
          currency: price ? currency : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setApiError(json.error || 'Failed to save product');
        setIsSubmitting(false);
        return;
      }
      router.push('/dashboard/products');
    } catch {
      setApiError('Network error. Please try again.');
      setIsSubmitting(false);
    }
  };

  const anyUploading = entries.some((e) => e.status === 'uploading');

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name */}
      <div className="space-y-1">
        <label htmlFor="product-name" className="block text-sm font-medium">
          Product Name <span className="text-destructive">*</span>
        </label>
        <input
          id="product-name"
          type="text"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Wireless Headphones"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label htmlFor="product-description" className="block text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="product-description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the product — key features, benefits, target audience…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-right text-xs text-muted-foreground">{description.length}/2000</p>
      </div>

      {/* Price + Currency */}
      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label htmlFor="product-price" className="block text-sm font-medium">
            Price <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="product-price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 89"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="w-28 space-y-1">
          <label htmlFor="product-currency" className="block text-sm font-medium">
            Currency
          </label>
          <select
            id="product-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Drop zone */}
      {entries.length < MAX_IMAGES && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={[
            'flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/60 hover:bg-muted/50',
          ].join(' ')}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            className="sr-only"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <ImageIcon className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Add product images</p>
          <p className="mt-1 text-xs text-muted-foreground">
            JPEG, PNG, WebP · Max 20 MB each · Up to {MAX_IMAGES} images
          </p>
        </div>
      )}

      {/* Previews grid */}
      {entries.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {entries.map((entry, idx) => (
            <div
              key={idx}
              className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
            >
              <img src={entry.preview} alt="" className="h-full w-full object-cover" />

              {/* Progress overlay */}
              {entry.status === 'uploading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                  <span className="mt-1 text-xs text-white">{entry.progress}%</span>
                </div>
              )}

              {/* Error overlay */}
              {entry.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-destructive/60">
                  <AlertCircle className="h-5 w-5 text-white" />
                </div>
              )}

              {/* Remove button */}
              {entry.status !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => removeEntry(idx)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 opacity-0 shadow transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* API error */}
      {apiError && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {apiError}
        </p>
      )}

      <button
        type="submit"
        disabled={!entries.length || !name.trim() || anyUploading || isSubmitting}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {anyUploading ? 'Uploading images…' : isSubmitting ? 'Saving…' : 'Create Product'}
      </button>
    </form>
  );
}
