import type { PlatformToken } from '@adavatar/types';

interface PublishParams {
  token: PlatformToken;
  generatedVideoUrl: string;
  caption: string;
  hashtags: string[];
}

/**
 * Publish a video to TikTok using Content Posting API v2.
 * Chunked upload flow: init → upload chunks → publish.
 */
export async function publishToTikTok({
  token,
  generatedVideoUrl,
  caption,
  hashtags,
}: PublishParams): Promise<string> {
  const fullCaption = `${caption} ${hashtags.join(' ')}`.trim();

  // Download video from Cloudinary
  const videoResponse = await fetch(generatedVideoUrl);
  if (!videoResponse.ok) throw new Error('Failed to download generated video');
  const videoBuffer = await videoResponse.arrayBuffer();
  const videoSize = videoBuffer.byteLength;

  // Step 1: Init upload
  const initResponse = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: fullCaption.slice(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: generatedVideoUrl,
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }),
    }
  );

  const initData = (await initResponse.json()) as {
    data?: { publish_id?: string };
    error?: { message: string };
  };

  if (!initResponse.ok || initData.error) {
    throw new Error(`TikTok init error: ${initData.error?.message ?? 'Unknown'}`);
  }

  const publishId = initData.data?.publish_id;
  if (!publishId) throw new Error('No publish_id returned from TikTok');

  return publishId;
}
