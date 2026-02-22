'use client';

import useSWR from 'swr';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Eye, Heart, MessageCircle, Share2, Film, Send } from 'lucide-react';

const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface OverviewData {
  totalAds: number;
  totalPublished: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
}

interface PlatformData {
  [platform: string]: { views: number; likes: number; posts: number };
}

interface AdRow {
  id: string;
  rawPrompt: string;
  generatedVideoUrl: string | null;
  totalViews: number;
  totalLikes: number;
  platforms: string[];
}

const PLATFORM_COLORS: Record<string, string> = {
  tiktok: '#000000',
  youtube: '#FF0000',
  instagram: '#E1306C',
  facebook: '#1877F2',
  snapchat: '#FFFC00',
};

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-3xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}

export function AnalyticsDashboard() {
  const { data: overviewRes } = useSWR<{ data: OverviewData; success: boolean }>(
    `${NEXT_PUBLIC_API_URL}/api/analytics/overview`,
    fetcher,
    { refreshInterval: 60000 }
  );

  const { data: platformRes } = useSWR<{ data: PlatformData; success: boolean }>(
    `${NEXT_PUBLIC_API_URL}/api/analytics/by-platform`,
    fetcher,
    { refreshInterval: 60000 }
  );

  const { data: adsRes } = useSWR<{ data: AdRow[]; success: boolean }>(
    `${NEXT_PUBLIC_API_URL}/api/analytics/ads`,
    fetcher,
    { refreshInterval: 60000 }
  );

  const overview = overviewRes?.data;
  const platformData = platformRes?.data ?? {};
  const adsData = adsRes?.data ?? [];

  // Transform platform data for recharts
  const platformChartData = Object.entries(platformData).map(([platform, stats]) => ({
    platform: platform.charAt(0).toUpperCase() + platform.slice(1),
    views: stats.views,
    likes: stats.likes,
    posts: stats.posts,
    fill: PLATFORM_COLORS[platform] ?? '#8884d8',
  }));

  // Top 5 ads by views for the bar chart
  const topAds = [...adsData]
    .sort((a, b) => b.totalViews - a.totalViews)
    .slice(0, 5)
    .map((ad) => ({
      name: ad.rawPrompt.length > 30 ? ad.rawPrompt.slice(0, 30) + '…' : ad.rawPrompt,
      views: ad.totalViews,
      likes: ad.totalLikes,
    }));

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Ads"
          value={overview?.totalAds ?? 0}
          icon={Film}
          color="bg-purple-100 text-purple-600"
        />
        <StatCard
          label="Posts Published"
          value={overview?.totalPublished ?? 0}
          icon={Send}
          color="bg-blue-100 text-blue-600"
        />
        <StatCard
          label="Total Views"
          value={overview?.totalViews ?? 0}
          icon={Eye}
          color="bg-green-100 text-green-600"
        />
        <StatCard
          label="Total Likes"
          value={overview?.totalLikes ?? 0}
          icon={Heart}
          color="bg-red-100 text-red-600"
        />
        <StatCard
          label="Comments"
          value={overview?.totalComments ?? 0}
          icon={MessageCircle}
          color="bg-yellow-100 text-yellow-600"
        />
        <StatCard
          label="Shares"
          value={overview?.totalShares ?? 0}
          icon={Share2}
          color="bg-pink-100 text-pink-600"
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Performance by Platform */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold">Performance by Platform</h2>
          {platformChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={platformChartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="platform" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="views" name="Views" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="likes" name="Likes" fill="#ec4899" radius={[4, 4, 0, 0]} />
                <Bar dataKey="posts" name="Posts" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Ads */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold">Top Ads by Views</h2>
          {topAds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={topAds}
                layout="vertical"
                margin={{ top: 4, right: 4, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="views" name="Views" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Per-Ad Breakdown Table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Per-Ad Performance</h2>
        </div>
        {adsData.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No published ads yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-muted-foreground">Ad</th>
                <th className="px-5 py-3 text-left font-medium text-muted-foreground">Platforms</th>
                <th className="px-5 py-3 text-right font-medium text-muted-foreground">Views</th>
                <th className="px-5 py-3 text-right font-medium text-muted-foreground">Likes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {adsData.map((ad) => (
                <tr key={ad.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {ad.generatedVideoUrl ? (
                        <video
                          src={ad.generatedVideoUrl}
                          className="h-9 w-9 rounded object-cover"
                          muted
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded bg-muted">
                          <Film className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <span className="max-w-[200px] truncate text-muted-foreground">
                        {ad.rawPrompt}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {ad.platforms.map((p) => (
                        <span
                          key={p}
                          className="rounded px-1.5 py-0.5 text-xs font-medium capitalize"
                          style={{
                            background: PLATFORM_COLORS[p] ?? '#8884d8',
                            color: p === 'snapchat' ? '#000' : '#fff',
                          }}
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">{ad.totalViews.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">{ad.totalLikes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
