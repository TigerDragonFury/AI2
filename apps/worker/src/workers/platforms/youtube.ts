import type { PlatformToken } from '@adavatar/types';
import { YOUTUBE_DEFAULT_CATEGORY_ID } from '@adavatar/config';

interface PublishParams {
  token: PlatformToken;
  generatedVideoUrl: string;
  caption: string;
  hashtags: string[];
}

/**
 * Upload to YouTube using the Data API v3 resumable upload.
 */
export async function publishToYouTube({
  token,
  generatedVideoUrl,
  caption,
  hashtags,
}: PublishParams): Promise<string> {
  const title = caption.slice(0, 100);
  const description = `${caption}\n\n${hashtags.join(' ')}`;
  const tags = hashtags.map((h) => h.replace(/^#/, ''));

  // Download video
  const videoResponse = await fetch(generatedVideoUrl);
  if (!videoResponse.ok) throw new Error('Failed to download generated video');
  const videoBuffer = await videoResponse.arrayBuffer();

  // Step 1: Initiate resumable upload
  const initResponse = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(videoBuffer.byteLength),
      },
      body: JSON.stringify({
        snippet: {
          title,
          description,
          tags,
          categoryId: YOUTUBE_DEFAULT_CATEGORY_ID,
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new Error(`YouTube init error: ${errText}`);
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) throw new Error('No upload URL from YouTube');

  // Step 2: Upload video
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(videoBuffer.byteLength),
    },
    body: videoBuffer,
  });

  const uploadData = (await uploadResponse.json()) as { id?: string; error?: { message: string } };

  if (!uploadResponse.ok || uploadData.error) {
    throw new Error(`YouTube upload error: ${uploadData.error?.message ?? 'Unknown'}`);
  }

  if (!uploadData.id) throw new Error('No video ID returned from YouTube');
  return uploadData.id;
}
