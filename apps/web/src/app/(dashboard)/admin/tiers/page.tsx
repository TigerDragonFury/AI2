'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useSession } from 'next-auth/react';
import { Save, Loader2, AlertTriangle, ShieldCheck, History } from 'lucide-react';
import type { UsageLimit, LimitChangeLog, SubscriptionTier } from '@adavatar/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const fetcher = (url: string, token: string) =>
  fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

const TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];
const FEATURES = ['avatar_creation', 'ad_generation', 'publish_jobs'];

const FEATURE_LABELS: Record<string, string> = {
  avatar_creation: 'Avatar Creation',
  ad_generation: 'Ad Generation',
  publish_jobs: 'Publishing',
};

function parseNullable(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

export default function AdminTiersPage() {
  const LIMITS_URL = `${API}/api/usage/admin/limits`;
  const LOGS_URL = `${API}/api/usage/admin/logs`;

  const { data: session } = useSession();
  const token = session?.accessToken ?? '';

  const { data: limitsData, isLoading } = useSWR<{
    data: UsageLimit[];
    success: boolean;
  }>(token ? LIMITS_URL : null, (url: string) => fetcher(url, token));

  const { data: logsData } = useSWR<{
    data: LimitChangeLog[];
    success: boolean;
  }>(token ? LOGS_URL : null, (url: string) => fetcher(url, token), { refreshInterval: 15000 });

  // localEdits stores overrides: "tier__feature" -> { daily, monthly }
  const [edits, setEdits] = useState<Record<string, { daily: string; monthly: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'limits' | 'logs'>('limits');

  const limits = limitsData?.data ?? [];
  const logs = logsData?.data ?? [];

  function getLimit(tier: SubscriptionTier, feature: string): UsageLimit | undefined {
    return limits.find((l) => l.tier === tier && l.feature === feature);
  }

  function getEditKey(tier: SubscriptionTier, feature: string): string {
    return `${tier}__${feature}`;
  }

  function getDraft(tier: SubscriptionTier, feature: string): { daily: string; monthly: string } {
    const key = getEditKey(tier, feature);
    if (edits[key]) return edits[key];
    const existing = getLimit(tier, feature);
    return {
      daily: existing?.dailyLimit?.toString() ?? '',
      monthly: existing?.monthlyLimit?.toString() ?? '',
    };
  }

  function handleChange(
    tier: SubscriptionTier,
    feature: string,
    field: 'daily' | 'monthly',
    value: string
  ) {
    const key = getEditKey(tier, feature);
    const current = getDraft(tier, feature);
    setEdits((prev) => ({ ...prev, [key]: { ...current, [field]: value } }));
    setSaveError(null);
  }

  async function handleSave(tier: SubscriptionTier, feature: string) {
    const key = getEditKey(tier, feature);
    const draft = getDraft(tier, feature);
    setSaving(key);
    setSaveError(null);
    try {
      const res = await fetch(`${API}/api/usage/admin/limits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tier,
          feature,
          dailyLimit: parseNullable(draft.daily),
          monthlyLimit: parseNullable(draft.monthly),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Save failed');
      // Clear local edit after success
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await globalMutate(LIMITS_URL);
      await globalMutate(LOGS_URL);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading limits…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Tier Limits</h1>
          <p className="text-sm text-muted-foreground">
            Configure daily and monthly limits per subscription tier. Changes take effect
            immediately.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['limits', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'limits' ? 'Configuration' : 'Change Log'}
          </button>
        ))}
      </div>

      {saveError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {saveError}
        </div>
      )}

      {activeTab === 'limits' && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Feature</th>
                {TIERS.map((tier) => (
                  <th
                    key={tier}
                    className="px-4 py-3 text-center font-semibold capitalize"
                    colSpan={3}
                  >
                    {tier}
                  </th>
                ))}
              </tr>
              <tr className="text-xs text-muted-foreground border-t border-border">
                <th className="px-4 py-2" />
                {TIERS.map((tier) => (
                  <>
                    <th key={`${tier}-daily`} className="px-2 py-2 text-center">
                      Daily
                    </th>
                    <th key={`${tier}-monthly`} className="px-2 py-2 text-center">
                      Monthly
                    </th>
                    <th key={`${tier}-save`} className="px-2 py-2" />
                  </>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {FEATURES.map((feature) => (
                <tr key={feature} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{FEATURE_LABELS[feature] ?? feature}</td>
                  {TIERS.map((tier) => {
                    const key = getEditKey(tier, feature);
                    const draft = getDraft(tier, feature);
                    const isSaving = saving === key;
                    const isDirty =
                      !!edits[key] &&
                      (edits[key].daily !==
                        (getLimit(tier, feature)?.dailyLimit?.toString() ?? '') ||
                        edits[key].monthly !==
                          (getLimit(tier, feature)?.monthlyLimit?.toString() ?? ''));

                    return (
                      <>
                        <td key={`${tier}-daily`} className="px-2 py-3 text-center">
                          <input
                            type="number"
                            min={1}
                            value={draft.daily}
                            onChange={(e) => handleChange(tier, feature, 'daily', e.target.value)}
                            placeholder="∞"
                            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </td>
                        <td key={`${tier}-monthly`} className="px-2 py-3 text-center">
                          <input
                            type="number"
                            min={1}
                            value={draft.monthly}
                            onChange={(e) => handleChange(tier, feature, 'monthly', e.target.value)}
                            placeholder="∞"
                            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </td>
                        <td key={`${tier}-save`} className="px-2 py-3 text-center">
                          <button
                            onClick={() => handleSave(tier, feature)}
                            disabled={isSaving || (!isDirty && !!getLimit(tier, feature))}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
                          >
                            {isSaving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Save className="h-3 w-3" />
                            )}
                            Save
                          </button>
                        </td>
                      </>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="rounded-xl border border-border overflow-hidden">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <History className="h-6 w-6" />
              <p className="text-sm">No changes recorded yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">When</th>
                  <th className="px-4 py-3 text-left font-semibold">Tier</th>
                  <th className="px-4 py-3 text-left font-semibold">Feature</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-center font-semibold">Old</th>
                  <th className="px-4 py-3 text-center font-semibold">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 capitalize">{log.tier}</td>
                    <td className="px-4 py-3">{FEATURE_LABELS[log.feature] ?? log.feature}</td>
                    <td className="px-4 py-3 capitalize">{log.limitType}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {log.oldValue ?? '∞'}
                    </td>
                    <td className="px-4 py-3 text-center font-medium">{log.newValue ?? '∞'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
