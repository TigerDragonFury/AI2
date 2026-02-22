import type { PlatformToken } from '@adavatar/types';

interface PublishParams {
  token: PlatformToken;
  generatedVideoUrl: string;
  caption: string;
  hashtags: string[];
}

/**
 * Publish video to a Facebook Page using Meta Graph API.
 * Uses the page's /videos endpoint.
 */
export async function publishToFacebook({
  token,
  generatedVideoUrl,
  caption,
  hashtags,
}: PublishParams): Promise<string> {
  const description = `${caption}\n\n${hashtags.join(' ')}`.trim();
  const pageId = token.platformUserId;

  const response = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/videos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_url: generatedVideoUrl,
        description,
        access_token: token.accessToken,
        published: true,
      }),
    }
  );

  const data = (await response.json()) as {
    id?: string;
    error?: { message: string };
  };

  if (!response.ok || data.error) {
    throw new Error(`Facebook publish error: ${data.error?.message ?? 'Unknown'}`);
  }

  if (!data.id) throw new Error('No video ID from Facebook');
  return data.id;
}
