import { prisma } from '../lib/prisma';

interface PlatformMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  clickThrough: number;
  rawData: Record<string, unknown>;
}

async function fetchTikTokMetrics(postId: string, accessToken: string): Promise<PlatformMetrics> {
  const response = await fetch(
    `https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count&video_ids=${postId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error('TikTok metrics fetch failed');
  const data = (await response.json()) as {
    data?: { videos?: Array<{ view_count?: number; like_count?: number; comment_count?: number; share_count?: number }> };
  };
  const video = data.data?.videos?.[0] ?? {};
  return {
    views: video.view_count ?? 0,
    likes: video.like_count ?? 0,
    comments: video.comment_count ?? 0,
    shares: video.share_count ?? 0,
    reach: 0,
    clickThrough: 0,
    rawData: data as Record<string, unknown>,
  };
}

async function fetchYouTubeMetrics(videoId: string, accessToken: string): Promise<PlatformMetrics> {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error('YouTube metrics fetch failed');
  const data = (await response.json()) as {
    items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
  };
  const stats = data.items?.[0]?.statistics ?? {};
  return {
    views: parseInt(stats.viewCount ?? '0'),
    likes: parseInt(stats.likeCount ?? '0'),
    comments: parseInt(stats.commentCount ?? '0'),
    shares: 0,
    reach: 0,
    clickThrough: 0,
    rawData: data as Record<string, unknown>,
  };
}

async function fetchInstagramMetrics(mediaId: string, accessToken: string): Promise<PlatformMetrics> {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${mediaId}/insights?metric=impressions,reach,likes,comments,shares&access_token=${accessToken}`
  );
  if (!response.ok) throw new Error('Instagram metrics fetch failed');
  const data = (await response.json()) as {
    data?: Array<{ name: string; values?: Array<{ value: number }> }>;
  };
  const getMetric = (name: string) =>
    data.data?.find((m) => m.name === name)?.values?.[0]?.value ?? 0;
  return {
    views: getMetric('impressions'),
    likes: getMetric('likes'),
    comments: getMetric('comments'),
    shares: getMetric('shares'),
    reach: getMetric('reach'),
    clickThrough: 0,
    rawData: data as Record<string, unknown>,
  };
}

export async function runAnalyticsIngestionCron() {
  const publishedJobs = await prisma.publishJob.findMany({
    where: { status: 'published', postId: { not: null } },
    include: {
      platformToken: { select: { accessToken: true } },
    },
  });

  let processed = 0;
  let errors = 0;

  for (const job of publishedJobs) {
    try {
      const { postId, platform } = job;
      if (!postId) continue;

      const accessToken = job.platformToken.accessToken;
      let metrics: PlatformMetrics | null = null;

      if (platform === 'tiktok') {
        metrics = await fetchTikTokMetrics(postId, accessToken);
      } else if (platform === 'youtube') {
        metrics = await fetchYouTubeMetrics(postId, accessToken);
      } else if (platform === 'instagram') {
        metrics = await fetchInstagramMetrics(postId, accessToken);
      }
      // Facebook and Snapchat: skip for now (similar pattern)

      if (metrics) {
        await prisma.analytics.create({
          data: {
            publishJobId: job.id,
            views: metrics.views,
            likes: metrics.likes,
            comments: metrics.comments,
            shares: metrics.shares,
            reach: metrics.reach,
            clickThrough: metrics.clickThrough,
            rawData: metrics.rawData,
            fetchedAt: new Date(),
          },
        });
        processed++;
      }
    } catch {
      errors++;
    }
  }

  console.log(`[analyticsCron] Processed: ${processed}, Errors: ${errors}`);
}
