'use client';

import { useState, useCallback } from 'react';

export type UploadState = 'idle' | 'uploading' | 'success' | 'error';

interface PresignResponse {
  signature: string;
  timestamp: number;
  folder: string;
  cloudName: string;
  apiKey: string;
}

interface UseCloudinaryUploadOptions {
  /** Called with the Cloudinary secure_url once upload completes */
  onSuccess?: (url: string) => void;
  onError?: (message: string) => void;
}

export function useCloudinaryUpload({ onSuccess, onError }: UseCloudinaryUploadOptions = {}) {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [secureUrl, setSecureUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File, token: string) => {
      setState('uploading');
      setProgress(0);
      setError(null);
      setSecureUrl(null);

      try {
        // 1. Get presign params from our API
        const presignRes = await fetch('/api/avatars/presign', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!presignRes.ok) {
          throw new Error('Failed to get upload credentials');
        }

        const { data }: { data: PresignResponse } = await presignRes.json();

        // 2. Build form data for Cloudinary
        const formData = new FormData();
        formData.append('file', file);
        formData.append('signature', data.signature);
        formData.append('timestamp', String(data.timestamp));
        formData.append('api_key', data.apiKey);
        formData.append('folder', data.folder);

        // 3. Upload to Cloudinary via XHR (for progress tracking)
        const url = `https://api.cloudinary.com/v1_1/${data.cloudName}/auto/upload`;

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 100));
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const result = JSON.parse(xhr.responseText);
              setSecureUrl(result.secure_url);
              setProgress(100);
              setState('success');
              onSuccess?.(result.secure_url);
              resolve();
            } else {
              reject(new Error(`Cloudinary upload failed: ${xhr.status}`));
            }
          });

          xhr.addEventListener('error', () => reject(new Error('Upload network error')));
          xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

          xhr.open('POST', url);
          xhr.send(formData);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setError(msg);
        setState('error');
        onError?.(msg);
      }
    },
    [onSuccess, onError]
  );

  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setSecureUrl(null);
    setError(null);
  }, []);

  return { state, progress, secureUrl, error, upload, reset };
}
