'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Upload, X, ImageIcon, VideoIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { useCloudinaryUpload } from '@/hooks/useCloudinaryUpload';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'];
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AvatarUploadForm() {
  const router = useRouter();
  const { data: session } = useSession();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Refs so callbacks always see latest name/file without stale closure
  const nameRef = useRef(name);
  nameRef.current = name;
  const fileRef = useRef(file);
  fileRef.current = file;

  // Called by useCloudinaryUpload after Cloudinary upload succeeds
  const handleUploadSuccess = useCallback(
    async (cloudUrl: string) => {
      if (!session?.accessToken) return;
      const inputType = fileRef.current?.type.startsWith('video') ? 'video' : 'image';

      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/avatars`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: nameRef.current, rawUrl: cloudUrl, inputType }),
        });

        const json = await res.json();
        if (!res.ok) {
          setApiError(json.error || 'Failed to save avatar');
          setIsSubmitting(false);
          return;
        }

        router.push('/dashboard/avatars');
      } catch {
        setApiError('Network error. Please try again.');
        setIsSubmitting(false);
      }
    },
    [session, router]
  );

  const {
    state: uploadState,
    progress,
    upload,
    reset,
  } = useCloudinaryUpload({
    presignUrl: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/avatars/presign`,
    onSuccess: handleUploadSuccess,
    onError: (msg) => {
      setApiError(msg);
      setIsSubmitting(false);
    },
  });

  const validateFile = (f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type))
      return 'Unsupported file type. Use JPEG, PNG, MP4, or MOV.';
    if (f.size > MAX_BYTES)
      return `File too large. Maximum is 200 MB (yours: ${formatBytes(f.size)}).`;
    return null;
  };

  const setValidFile = (f: File) => {
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      setFile(null);
    } else {
      setFileError(null);
      setFile(f);
      if (!nameRef.current) setName(f.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setValidFile(dropped);
  }, []);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) setValidFile(picked);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !session?.accessToken) return;
    setApiError(null);
    setIsSubmitting(true);
    await upload(file, session.accessToken as string);
    // isSubmitting cleared by callbacks above
  };

  const clearFile = () => {
    setFile(null);
    setFileError(null);
    reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  const isUploading = uploadState === 'uploading';
  const isSuccess = uploadState === 'success';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name field */}
      <div className="space-y-1">
        <label htmlFor="avatar-name" className="block text-sm font-medium text-foreground">
          Avatar Name <span className="text-destructive">*</span>
        </label>
        <input
          id="avatar-name"
          type="text"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My AI Avatar"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Drop zone */}
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
          'relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/60 hover:bg-muted/50',
          file ? 'bg-muted/30' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="sr-only"
          onChange={handleFilePick}
        />

        {file ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              {file.type.startsWith('video') ? (
                <VideoIcon className="h-6 w-6 text-primary" />
              ) : (
                <ImageIcon className="h-6 w-6 text-primary" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearFile();
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" /> Remove
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Drag &amp; drop or click to upload</p>
              <p className="mt-1 text-xs text-muted-foreground">JPEG, PNG, MP4, MOV · Max 200 MB</p>
            </div>
          </div>
        )}
      </div>

      {/* File error */}
      {fileError && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {fileError}
        </p>
      )}

      {/* Upload progress */}
      {isUploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Uploading…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Success state */}
      {isSuccess && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          File uploaded — saving avatar…
        </div>
      )}

      {/* API error */}
      {apiError && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {apiError}
        </p>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={!file || !name.trim() || isUploading || isSubmitting}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isUploading
          ? `Uploading… ${progress}%`
          : isSubmitting
            ? 'Saving…'
            : 'Upload & Create Avatar'}
      </button>
    </form>
  );
}
