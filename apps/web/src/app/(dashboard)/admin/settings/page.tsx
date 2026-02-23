'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useSession } from 'next-auth/react';
import { Save, Trash2, Loader2, Bot, Eye, EyeOff, RefreshCw } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const fetcher = (url: string, token: string) =>
  fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

const SETTINGS_URL = `${API}/api/settings`;

interface SettingRow {
  key: string;
  value: string; // already masked by the server for secrets
  updatedAt: string;
  updatedBy: string | null;
}

const SETTING_META: Record<
  string,
  { label: string; description: string; type: 'select' | 'password'; options?: string[] }
> = {
  ai_provider: {
    label: 'AI Provider',
    description: 'Which AI service processes avatar animations and ad videos.',
    type: 'select',
    options: ['dashscope', 'fal', 'huggingface'],
  },
  alibaba_api_key: {
    label: 'Alibaba Cloud (DashScope) API Key',
    description:
      'Required when provider is "dashscope". Get one at modelstudio.console.alibabacloud.com — 90-day free quota for new users.',
    type: 'password',
  },
  fal_key: {
    label: 'fal.ai API Key',
    description: 'Required when provider is "fal". Get one at fal.ai/dashboard.',
    type: 'password',
  },
  huggingface_api_key: {
    label: 'HuggingFace API Token',
    description:
      'Required when provider is "huggingface". Needs a Pro subscription for LivePortrait model access.',
    type: 'password',
  },
};

const ALL_KEYS = Object.keys(SETTING_META);

export default function AdminSettingsPage() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? '';

  const { data, isLoading } = useSWR<{ success: boolean; data: SettingRow[] }>(
    token ? SETTINGS_URL : null,
    (url: string) => fetcher(url, token)
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = data?.data ?? [];

  function getStored(key: string): SettingRow | undefined {
    return settings.find((s) => s.key === key);
  }

  function getDraft(key: string): string {
    return drafts[key] ?? '';
  }

  async function handleSave(key: string) {
    const value = getDraft(key);
    if (!value.trim()) return;
    setSaving(key);
    setError(null);
    try {
      const res = await fetch(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, value: value.trim() }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? 'Save failed');
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await globalMutate(SETTINGS_URL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(key: string) {
    if (
      !confirm(
        `Remove "${key}" from the database? The worker will fall back to the environment variable.`
      )
    )
      return;
    setDeleting(key);
    setError(null);
    try {
      const res = await fetch(`${SETTINGS_URL}/${key}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? 'Delete failed');
      await globalMutate(SETTINGS_URL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">AI Provider Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure which AI service processes videos and store API keys in the database. Values
            here override environment variables — no redeploy needed.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Settings cards */}
      <div className="space-y-4">
        {ALL_KEYS.map((key) => {
          const meta = SETTING_META[key];
          const stored = getStored(key);
          const draft = getDraft(key);
          const isSaving = saving === key;
          const isDeleting = deleting === key;
          const isReveal = reveal[key] ?? false;

          return (
            <div key={key} className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{meta.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
                </div>
                {stored && (
                  <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                    Set in DB
                  </span>
                )}
                {!stored && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Env var / not set
                  </span>
                )}
              </div>

              {/* Current stored value (masked) */}
              {stored && (
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                  <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground text-xs">Current:</span>
                  <span className="font-mono text-xs">
                    {meta.type === 'password' && !isReveal ? stored.value : stored.value}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Updated {new Date(stored.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              )}

              {/* Input row */}
              <div className="flex gap-2">
                {meta.type === 'select' ? (
                  <select
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={draft}
                    onChange={(e) => setDrafts((p) => ({ ...p, [key]: e.target.value }))}
                  >
                    <option value="">— select provider —</option>
                    {meta.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="relative flex-1">
                    <input
                      type={isReveal ? 'text' : 'password'}
                      placeholder={stored ? 'Enter new value to update…' : 'Enter API key…'}
                      value={draft}
                      onChange={(e) => setDrafts((p) => ({ ...p, [key]: e.target.value }))}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((p) => ({ ...p, [key]: !isReveal }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {isReveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                )}

                <button
                  onClick={() => handleSave(key)}
                  disabled={!draft.trim() || isSaving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save
                </button>

                {stored && (
                  <button
                    onClick={() => handleDelete(key)}
                    disabled={isDeleting}
                    title="Remove from DB (reverts to env var)"
                    className="flex items-center rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Worker reads new values within 60 seconds (cached). No restart or redeploy required.
      </p>
    </div>
  );
}
