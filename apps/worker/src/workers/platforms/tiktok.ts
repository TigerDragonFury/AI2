import type { PlatformToken } from '@adavatar/types';

interface PublishParams {
  token: PlatformToken;
  generatedVideoUrl: string;
  caption: string;
  hashtags: string[];
}

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

/**
 * Publish a video to TikTok using Content Posting API v2 — FILE_UPLOAD source.
 * Flow: download → init upload → PUT chunks → poll for publish_id.
 */
export async function publishToTikTok({
  token,
  generatedVideoUrl,
  caption,
  hashtags,
}: PublishParams): Promise<string> {
  const fullCaption = `${caption} ${hashtags.join(' ')}`.trim();

  // ── Step 1: Download video from Cloudinary ────────────────────────────────
  const videoResponse = await fetch(generatedVideoUrl);
  if (!videoResponse.ok) throw new Error('Failed to download generated video from Cloudinary');
  const videoBuffer = await videoResponse.arrayBuffer();
  const videoSize = videoBuffer.byteLength;

  // Single-chunk upload. TikTok docs say min chunk_size is 5 MB, but that
  // applies to non-final chunks only — the last (and only) chunk may be any
  // size. Sending chunk_size === video_size makes total_chunk_count unambiguous.
  const chunkSize = videoSize;
  const totalChunks = 1;

  console.log(
    `[TikTok] video_size=${videoSize} chunk_size=${chunkSize} total_chunk_count=${totalChunks}`
  );

  // ── Step 2: Init upload (FILE_UPLOAD) ─────────────────────────────────────
  const initResponse = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      post_info: {
        title: fullCaption.slice(0, 150),
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  });

  const initData = (await initResponse.json()) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };

  console.log('[TikTok] init response:', JSON.stringify(initData));
  if (!initResponse.ok || (initData.error?.code && initData.error.code !== 'ok')) {
    throw new Error(`TikTok init error: ${initData.error?.message ?? JSON.stringify(initData)}`);
  }

  const publishId = initData.data?.publish_id;
  const uploadUrl = initData.data?.upload_url;
  if (!publishId || !uploadUrl) throw new Error('TikTok init did not return publish_id/upload_url');

  // ── Step 3: Upload chunks ─────────────────────────────────────────────────
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, videoSize);
    const chunk = videoBuffer.slice(start, end);

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${start}-${end - 1}/${videoSize}`,
        'Content-Length': String(end - start),
      },
      body: chunk,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`TikTok chunk ${i + 1}/${totalChunks} upload failed: ${errText}`);
    }
  }

  // ── Step 4: Poll for publish status to get post_id ────────────────────────
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 4000));

    const statusRes = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const statusData = (await statusRes.json()) as {
      data?: { status?: string; post_id?: string; fail_reason?: string };
      error?: { code?: string; message?: string };
    };

    const status = statusData.data?.status;
    if (status === 'PUBLISH_COMPLETE') {
      return statusData.data?.post_id ?? publishId;
    }
    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed: ${statusData.data?.fail_reason ?? 'unknown'}`);
    }
    // statuses: PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SENDING_TO_USER_INBOX — keep polling
  }

  // If we timed out polling but the upload succeeded, return publishId as fallback
  return publishId;
}
