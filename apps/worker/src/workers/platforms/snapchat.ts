import type { PlatformToken } from '@adavatar/types';

interface PublishParams {
  token: PlatformToken;
  generatedVideoUrl: string;
  caption: string;
  hashtags: string[];
}

/**
 * Publish a video Snap Ad using Snapchat Marketing API.
 * Flow: upload creative asset → create Snap Ad object.
 * Requires a Snapchat Business account.
 */
export async function publishToSnapchat({
  token,
  generatedVideoUrl,
  caption,
  hashtags,
}: PublishParams): Promise<string> {
  const name = `${caption.slice(0, 50)} ${hashtags.slice(0, 3).join(' ')}`.trim();

  // Step 1: Upload creative asset
  const assetResponse = await fetch(
    'https://adsapi.snapchat.com/v1/media',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        media: [
          {
            name,
            type: 'VIDEO',
            ad_account_id: token.platformUserId,
            download_link: generatedVideoUrl,
          },
        ],
      }),
    }
  );

  const assetData = (await assetResponse.json()) as {
    request_status?: string;
    media?: Array<{ media?: { id: string } }>;
    error_message?: string;
  };

  if (!assetResponse.ok || assetData.error_message) {
    throw new Error(`Snapchat asset upload error: ${assetData.error_message ?? 'Unknown'}`);
  }

  const mediaId = assetData.media?.[0]?.media?.id;
  if (!mediaId) throw new Error('No media ID from Snapchat');

  // Step 2: Create a Snap Ad creative
  const creativeResponse = await fetch(
    'https://adsapi.snapchat.com/v1/creatives',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        creatives: [
          {
            name,
            ad_account_id: token.platformUserId,
            type: 'SNAP_AD',
            top_snap_media_id: mediaId,
            top_snap_crop_position: 'MIDDLE',
          },
        ],
      }),
    }
  );

  const creativeData = (await creativeResponse.json()) as {
    creatives?: Array<{ creative?: { id: string } }>;
    error_message?: string;
  };

  if (!creativeResponse.ok || creativeData.error_message) {
    throw new Error(`Snapchat creative error: ${creativeData.error_message ?? 'Unknown'}`);
  }

  const snapId = creativeData.creatives?.[0]?.creative?.id;
  if (!snapId) throw new Error('No creative ID from Snapchat');
  return snapId;
}
