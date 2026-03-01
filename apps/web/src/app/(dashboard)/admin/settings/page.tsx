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
  // ── AI Provider + API Keys ────────────────────────────────────────────────
  ai_provider: {
    label: 'AI Provider',
    description: 'Which AI service generates ad videos.',
    type: 'select',
    options: ['kling', 'dashscope', 'google', 'fal', 'huggingface'],
  },
  alibaba_api_key: {
    label: 'Alibaba Cloud (DashScope) API Key',
    description:
      'Required when provider is "dashscope". Get one at modelstudio.console.alibabacloud.com — 90-day free quota for new users.',
    type: 'password',
  },
  gemini_api_key: {
    label: 'Google Gemini API Key',
    description:
      'Required when provider is "google" (Veo 3.1). Get one at aistudio.google.com/app/apikey.',
    type: 'password',
  },
  kling_api_key: {
    label: 'Kie.ai API Key',
    description:
      'Required when provider is "kling" (Veo 3.1 via kie.ai — no daily quota, 25% of Google pricing). Get one at kie.ai/api-key.',
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
  // ── DashScope Model Overrides ─────────────────────────────────────────────
  tts_model: {
    label: 'TTS Model',
    description: 'Qwen3-TTS model for voiceover synthesis (DashScope provider only).',
    type: 'select',
    options: ['qwen3-tts-flash', 'qwen3-tts-instruct-flash'],
  },
  dialogue_model: {
    label: 'Dialogue / Script LLM',
    description: 'Qwen model used to auto-generate ad dialogue scripts.',
    type: 'select',
    options: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
  },
  vision_model: {
    label: 'Vision LLM (Auto-prompt)',
    description: 'Qwen-VL model used to analyse product images and generate scene descriptions.',
    type: 'select',
    options: ['qwen-vl-plus', 'qwen-vl-max'],
  },
  i2v_model: {
    label: 'Image-to-Video Model',
    description: 'Wan model used to animate the composite image into the final ad video.',
    type: 'select',
    options: ['wan2.6-i2v', 'wan2.1-i2v-turbo'],
  },
  i2i_model: {
    label: 'Image Composite Model',
    description:
      'Wan model used in Step 1 to fuse the avatar photo + product image (DashScope only).',
    type: 'select',
    options: ['wan2.5-i2i-preview'],
  },
  veo_model: {
    label: 'Veo Model',
    description: 'Google Veo model for video generation (Google provider only).',
    type: 'select',
    options: ['veo-3.1-generate-preview', 'veo-2.0-generate-001'],
  },
  gemini_tts_model: {
    label: 'Gemini TTS Model',
    description: 'Gemini TTS model for voiceover synthesis (Google provider only).',
    type: 'select',
    options: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
  },
  kling_veo_model: {
    label: 'Kling Veo Model',
    description:
      'Veo model used via kie.ai. veo3_fast supports REFERENCE_2_VIDEO (preserves subject appearance); veo3 is higher quality but image-to-video only.',
    type: 'select',
    options: ['veo3_fast', 'veo3'],
  },
  // ── Cinematic Timeline Prompt ─────────────────────────────────────────────────
  cinematic_prompt_enabled: {
    label: 'Cinematic Prompt Expansion',
    description:
      'When enabled, Gemini expands the scene description into a Hollywood-style timeline script (Hook → Context → Climax → Resolution) before sending to Veo. Improves output quality noticeably. Uses ~1–2 Gemini Flash calls per ad.',
    type: 'select',
    options: ['true', 'false'],
  },
  cinematic_prompt_model: {
    label: 'Cinematic Prompt Model',
    description:
      'Gemini model used to generate the cinematic timeline script. gemini-2.0-flash is fast and cheap (default). Requires a Gemini API key.',
    type: 'select',
    options: ['gemini-2.0-flash', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-pro-preview-05-06'],
  },
  // ── Storage & Google Drive Backup ─────────────────────────────────────────
  storage_backup: {
    label: 'Storage Backup Mode',
    description:
      'cloudinary_only — default, videos stored only in Cloudinary. cloudinary_gdrive — Cloudinary stays primary; every generated video is also backed up to your Drive folder.',
    type: 'select',
    options: ['cloudinary_only', 'cloudinary_gdrive'],
  },
  gdrive_folder_id: {
    label: 'Google Drive Folder ID',
    description:
      'ID of the Drive folder where backup videos will be uploaded. Find it in the folder URL: drive.google.com/drive/folders/<FOLDER_ID>.',
    type: 'password',
  },
  gdrive_refresh_token: {
    label: 'Google Drive Refresh Token',
    description:
      'One-time setup: go to developers.google.com/oauthplayground → gear icon → "Use your own OAuth credentials" → paste your Google Client ID & Secret → select scope "drive.file" → authorise → Exchange code → copy the Refresh Token. Reuses your existing Google/YouTube client credentials.',
    type: 'password',
  },
  // ── Platform OAuth Credentials ─────────────────────────────────────────────────
  tiktok_client_id: {
    label: 'TikTok Client Key',
    description:
      'From TikTok Developer Portal → App → Client Key. Also used as client_key in OAuth.',
    type: 'password',
  },
  tiktok_client_secret: {
    label: 'TikTok Client Secret',
    description: 'From TikTok Developer Portal → App → Client Secret.',
    type: 'password',
  },
  google_client_id: {
    label: 'Google / YouTube Client ID',
    description: 'OAuth 2.0 Client ID from Google Cloud Console (for YouTube publishing).',
    type: 'password',
  },
  google_client_secret: {
    label: 'Google / YouTube Client Secret',
    description: 'OAuth 2.0 Client Secret from Google Cloud Console.',
    type: 'password',
  },
  meta_app_id: {
    label: 'Meta App ID',
    description: 'Facebook App ID (used for both Instagram and Facebook publishing).',
    type: 'password',
  },
  meta_app_secret: {
    label: 'Meta App Secret',
    description: 'Facebook App Secret.',
    type: 'password',
  },
  snapchat_client_id: {
    label: 'Snapchat Client ID',
    description: 'From Snapchat Developer Portal → App credentials.',
    type: 'password',
  },
  snapchat_client_secret: {
    label: 'Snapchat Client Secret',
    description: 'From Snapchat Developer Portal → App credentials.',
    type: 'password',
  },
};

const SECTIONS = [
  {
    title: 'AI Provider & API Keys',
    keys: [
      'ai_provider',
      'kling_api_key',
      'alibaba_api_key',
      'gemini_api_key',
      'fal_key',
      'huggingface_api_key',
    ],
  },
  {
    title: 'AI Model Overrides',
    description:
      'Override which specific model is used for each pipeline step. Leave unset to use the code default.',
    keys: [
      'tts_model',
      'dialogue_model',
      'vision_model',
      'i2v_model',
      'i2i_model',
      'veo_model',
      'gemini_tts_model',
      'kling_veo_model',
    ],
  },
  {
    title: 'Cinematic Prompt',
    description:
      'Optionally enrich every ad prompt with a Gemini-generated cinematic timeline script before sending to Veo. Inspired by Hollywood director briefs for higher-quality output.',
    keys: ['cinematic_prompt_enabled', 'cinematic_prompt_model'],
  },
  {
    title: 'Storage & Backup',
    description:
      'Cloudinary is always the primary video store. Optionally back up every generated ad video to a Google Drive folder for archive, download, or sharing.',
    keys: ['storage_backup', 'gdrive_folder_id', 'gdrive_refresh_token'],
  },
  {
    title: 'Platform OAuth Credentials',
    description: 'Store your social platform app credentials here — no env var or redeploy needed.',
    keys: [
      'tiktok_client_id',
      'tiktok_client_secret',
      'google_client_id',
      'google_client_secret',
      'meta_app_id',
      'meta_app_secret',
      'snapchat_client_id',
      'snapchat_client_secret',
    ],
  },
] as const;

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
          <h1 className="text-2xl font-bold">AI Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Configure the AI provider, API keys, and model overrides. Values stored here override
            environment variables — no redeploy needed. Worker picks up changes within 60 seconds.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Settings sections */}
      {SECTIONS.map((section) => (
        <div key={section.title} className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">{section.title}</h2>
            {'description' in section && (
              <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
            )}
          </div>
          {(section.keys as unknown as string[]).map((key) => {
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
                      <option value="">— select —</option>
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
      ))}

      <p className="text-xs text-muted-foreground">
        Worker reads new values within 60 seconds (cached). No restart or redeploy required.
      </p>
    </div>
  );
}
