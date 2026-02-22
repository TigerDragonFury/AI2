'use client';

import type { UsageFeatureStatus } from '@adavatar/types';

const FEATURE_LABELS: Record<string, string> = {
  avatar_creation: 'Avatar Creation',
  ad_generation: 'Ad Generation',
  publish_jobs: 'Publishing',
};

interface UsageBarsProps {
  usages: UsageFeatureStatus[];
  className?: string;
}

function UsageBar({
  label,
  used,
  limit,
  type,
}: {
  label: string;
  used: number;
  limit: number | null;
  type: 'daily' | 'monthly';
}) {
  if (limit === null) return null;

  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 90 ? 'bg-destructive' : pct >= 60 ? 'bg-yellow-500' : 'bg-primary';
  const ring =
    pct >= 90 ? 'ring-1 ring-destructive/40' : pct >= 60 ? 'ring-1 ring-yellow-500/40' : '';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground capitalize">{type}</span>
        <span className={pct >= 90 ? 'font-semibold text-destructive' : 'text-foreground'}>
          {used} / {limit}
        </span>
      </div>
      <div className={`h-2 w-full overflow-hidden rounded-full bg-muted ${ring}`}>
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {pct >= 90 && (
        <p className="text-xs text-destructive">
          {pct === 100
            ? `${label} ${type} limit reached`
            : `${label} ${type} limit almost full (${100 - pct}% remaining)`}
        </p>
      )}
    </div>
  );
}

export function UsageBars({ usages, className }: UsageBarsProps) {
  if (!usages || usages.length === 0) return null;

  return (
    <div className={`space-y-4 rounded-lg border border-border p-4 ${className ?? ''}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Usage Limits
      </h3>
      {usages.map((u) => {
        const label = FEATURE_LABELS[u.feature] ?? u.feature;
        const hasAny = u.daily.limit !== null || u.monthly.limit !== null;
        if (!hasAny) return null;
        return (
          <div key={u.feature} className="space-y-3">
            <p className="text-sm font-medium">{label}</p>
            <UsageBar label={label} used={u.daily.used} limit={u.daily.limit} type="daily" />
            <UsageBar label={label} used={u.monthly.used} limit={u.monthly.limit} type="monthly" />
          </div>
        );
      })}
    </div>
  );
}
