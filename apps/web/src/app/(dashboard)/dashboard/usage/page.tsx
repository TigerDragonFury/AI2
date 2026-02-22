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
import { Loader2, AlertTriangle, Activity } from 'lucide-react';
import type { UsageFeatureStatus, UsageHistory } from '@adavatar/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

const FEATURE_LABELS: Record<string, string> = {
  avatar_creation: 'Avatar Creation',
  ad_generation: 'Ad Generation',
  publish_jobs: 'Publishing',
};

const FEATURE_COLORS: Record<string, string> = {
  avatar_creation: '#8b5cf6',
  ad_generation: '#06b6d4',
  publish_jobs: '#10b981',
};

function pct(used: number, limit: number | null): number {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function BarColor(p: number): string {
  if (p >= 90) return 'bg-destructive';
  if (p >= 60) return 'bg-yellow-500';
  return 'bg-primary';
}

function QuotaCard({ stat }: { stat: UsageFeatureStatus }) {
  const label = FEATURE_LABELS[stat.feature] ?? stat.feature;
  const dayPct = pct(stat.daily.used, stat.daily.limit);
  const monPct = pct(stat.monthly.used, stat.monthly.limit);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <p className="font-semibold">{label}</p>

      {stat.daily.limit !== null && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Today</span>
            <span className={dayPct >= 90 ? 'text-destructive font-semibold' : ''}>
              {stat.daily.used} / {stat.daily.limit}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${BarColor(dayPct)}`}
              style={{ width: `${dayPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{dayPct}% used today</p>
        </div>
      )}

      {stat.monthly.limit !== null && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>This month</span>
            <span className={monPct >= 90 ? 'text-destructive font-semibold' : ''}>
              {stat.monthly.used} / {stat.monthly.limit}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${BarColor(monPct)}`}
              style={{ width: `${monPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{monPct}% used this month</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground capitalize">
        Tier: <span className="font-medium text-foreground">{stat.tier}</span>
      </p>
    </div>
  );
}

function buildDailyChartData(daily: UsageHistory['daily']) {
  const map: Record<string, Record<string, number>> = {};
  for (const row of daily) {
    const key = new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!map[key]) map[key] = {};
    map[key][row.feature] = (map[key][row.feature] ?? 0) + row.count;
  }
  return Object.entries(map).map(([date, vals]) => ({ date, ...vals }));
}

function buildMonthlyChartData(monthly: UsageHistory['monthly']) {
  const map: Record<string, Record<string, number>> = {};
  for (const row of monthly) {
    const key = `${row.year}-${String(row.month).padStart(2, '0')}`;
    if (!map[key]) map[key] = {};
    map[key][row.feature] = (map[key][row.feature] ?? 0) + row.count;
  }
  return Object.entries(map).map(([month, vals]) => ({ month, ...vals }));
}

export default function UsagePage() {
  const { data: currentData, isLoading: loadingCurrent } = useSWR<{
    data: UsageFeatureStatus[];
    success: boolean;
  }>(`${API}/api/usage`, fetcher, { refreshInterval: 30000 });

  const { data: historyData, isLoading: loadingHistory } = useSWR<{
    data: UsageHistory;
    success: boolean;
  }>(`${API}/api/usage/history`, fetcher);

  const current = currentData?.data ?? [];
  const history = historyData?.data;

  const dailyChartData = history ? buildDailyChartData(history.daily) : [];
  const monthlyChartData = history ? buildMonthlyChartData(history.monthly) : [];

  const features = ['avatar_creation', 'ad_generation', 'publish_jobs'];

  if (loadingCurrent && loadingHistory) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading usage data…
      </div>
    );
  }

  if (!currentData?.success && !loadingCurrent) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertTriangle className="h-6 w-6" />
        <p>Unable to load usage data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6" /> Usage
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your current quota usage and historical consumption.
        </p>
      </div>

      {/* Current quotas */}
      <section>
        <h2 className="mb-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          Current Period
        </h2>
        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage limits configured for your tier.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {current.map((stat) => (
              <QuotaCard key={stat.feature} stat={stat} />
            ))}
          </div>
        )}
      </section>

      {/* Daily 7-day chart */}
      {dailyChartData.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Daily Usage — Last 7 Days
          </h2>
          <div className="rounded-xl border border-border bg-card p-5">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyChartData} margin={{ top: 0, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                {features.map((f) => (
                  <Bar
                    key={f}
                    dataKey={f}
                    name={FEATURE_LABELS[f]}
                    fill={FEATURE_COLORS[f]}
                    radius={[3, 3, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Monthly 3-month chart */}
      {monthlyChartData.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Monthly Usage — Last 3 Months
          </h2>
          <div className="rounded-xl border border-border bg-card p-5">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={monthlyChartData}
                margin={{ top: 0, right: 16, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                {features.map((f) => (
                  <Bar
                    key={f}
                    dataKey={f}
                    name={FEATURE_LABELS[f]}
                    fill={FEATURE_COLORS[f]}
                    radius={[3, 3, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}
