import type { PlatformToken } from '@adavatar/types';

interface PublishParams {
  token: PlatformToken;
  generatedVideoUrl: string;
  caption: string;
  hashtags: string[];
}

/**
 * Publish video to Instagram using Meta Graph API (two-step: container → publish).
 * Requires an Instagram Business account linked to a Facebook Page.
 */
export async function publishToInstagram({
  token,
  generatedVideoUrl,
  caption,
  hashtags,
}: PublishParams): Promise<string> {
  const fullCaption = `${caption}\n\n${hashtags.join(' ')}`.trim();
  const igUserId = token.platformUserId;

  // Step 1: Create media container
  const containerResponse = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: generatedVideoUrl,
        caption: fullCaption,
        media_type: 'REELS',
        access_token: token.accessToken,
      }),
    }
  );

  const containerData = (await containerResponse.json()) as {
    id?: string;
    error?: { message: string };
  };

  if (!containerResponse.ok || containerData.error) {
    throw new Error(`Instagram container error: ${containerData.error?.message ?? 'Unknown'}`);
  }

  const containerId = containerData.id;
  if (!containerId) throw new Error('No container ID from Instagram');

  // Wait for container to be ready
  await new Promise((res) => setTimeout(res, 5000));

  // Step 2: Publish container
  const publishResponse = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: token.accessToken,
      }),
    }
  );

  const publishData = (await publishResponse.json()) as {
    id?: string;
    error?: { message: string };
  };

  if (!publishResponse.ok || publishData.error) {
    throw new Error(`Instagram publish error: ${publishData.error?.message ?? 'Unknown'}`);
  }

  if (!publishData.id) throw new Error('No media ID from Instagram');
  return publishData.id;
}
