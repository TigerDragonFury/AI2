'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Upload, CheckCircle2 } from 'lucide-react';
import Image from 'next/image';

const BRAND_VOICE_PRESETS = [
  { value: 'luxury', label: 'Luxury', description: 'Premium, exclusive, aspirational' },
  { value: 'casual', label: 'Casual', description: 'Friendly, relaxed, approachable' },
  {
    value: 'professional',
    label: 'Professional',
    description: 'Authoritative, trustworthy, clear',
  },
  { value: 'playful', label: 'Playful', description: 'Fun, energetic, youthful' },
  { value: 'bold', label: 'Bold', description: 'Confident, direct, powerful' },
] as const;

type BrandVoicePreset = (typeof BRAND_VOICE_PRESETS)[number]['value'];

interface Profile {
  companyName: string | null;
  companyLogoUrl: string | null;
  brandVoicePreset: BrandVoicePreset | null;
  brandVoiceCustom: string | null;
  productCategories: string | null;
  onboardingDone: boolean;
}

interface BrandProfileFormProps {
  /** Called after a successful save so the parent can update onboarding state */
  onSaved?: (profile: Profile) => void;
  /** When true, show a "Welcome" header suitable for the onboarding context */
  isOnboarding?: boolean;
}

export function BrandProfileForm({ onSaved, isOnboarding = false }: BrandProfileFormProps) {
  const { data: session } = useSession();
  const token = session?.accessToken as string | undefined;

  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [brandVoicePreset, setBrandVoicePreset] = useState<BrandVoicePreset | null>(null);
  const [brandVoiceCustom, setBrandVoiceCustom] = useState('');
  const [productCategories, setProductCategories] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);

  // Load existing profile
  useEffect(() => {
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(({ data }: { data: Profile }) => {
        if (!data) return;
        setCompanyName(data.companyName ?? '');
        setCompanyLogoUrl(data.companyLogoUrl ?? null);
        setBrandVoicePreset(data.brandVoicePreset ?? null);
        setBrandVoiceCustom(data.brandVoiceCustom ?? '');
        setProductCategories(data.productCategories ?? '');
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [token]);

  const uploadLogo = async (file: File) => {
    if (!token) return;
    setIsUploadingLogo(true);
    try {
      const ps = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile/logo/presign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!ps.ok) throw new Error('Failed to get upload credentials');
      const { data } = await ps.json();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', data.signature);
      formData.append('timestamp', String(data.timestamp));
      formData.append('api_key', data.apiKey);
      formData.append('folder', data.folder);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`,
        { method: 'POST', body: formData }
      );
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { secure_url } = await uploadRes.json();
      setCompanyLogoUrl(secure_url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setIsSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName || null,
          companyLogoUrl: companyLogoUrl || null,
          brandVoicePreset: brandVoicePreset || null,
          brandVoiceCustom: brandVoiceCustom || null,
          productCategories: productCategories || null,
          onboardingDone: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to save');
        return;
      }
      setSaved(true);
      onSaved?.(json.data);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading profile...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {isOnboarding && (
        <div className="rounded-lg bg-primary/5 p-4 text-center">
          <h2 className="text-lg font-semibold">Tell us about your brand</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This information is used to personalise the AI-generated voiceovers and ad scripts.
          </p>
        </div>
      )}

      {/* Company name + logo */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Company / Brand Name</label>
          <input
            type="text"
            maxLength={200}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. AlSaraya Butchery"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Company Logo</label>
          <div className="flex items-center gap-3">
            {companyLogoUrl ? (
              <div className="relative h-12 w-12 overflow-hidden rounded-md border border-border">
                <Image src={companyLogoUrl} alt="Logo" fill className="object-contain" />
              </div>
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border bg-muted text-muted-foreground">
                <Upload className="h-5 w-5" />
              </div>
            )}
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={isUploadingLogo}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {isUploadingLogo ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading...
                </>
              ) : (
                <>{companyLogoUrl ? 'Change' : 'Upload'} logo</>
              )}
            </button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
            />
          </div>
        </div>
      </div>

      {/* Product categories */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Product Categories</label>
        <input
          type="text"
          maxLength={500}
          value={productCategories}
          onChange={(e) => setProductCategories(e.target.value)}
          placeholder="e.g. Perfumes & Fragrances, Luxury Apparel, Food & Beverage"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Helps the AI tailor ad scripts to your industry.
        </p>
      </div>

      {/* Brand voice preset */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Brand Voice</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {BRAND_VOICE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() =>
                setBrandVoicePreset(preset.value === brandVoicePreset ? null : preset.value)
              }
              className={[
                'flex flex-col items-start rounded-lg border-2 p-3 text-left text-sm transition-all',
                brandVoicePreset === preset.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40',
              ].join(' ')}
            >
              <span className="font-semibold">{preset.label}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom brand voice override */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium">
          Custom Tone <span className="font-normal text-muted-foreground">(optional override)</span>
        </label>
        <textarea
          rows={2}
          maxLength={300}
          value={brandVoiceCustom}
          onChange={(e) => setBrandVoiceCustom(e.target.value)}
          placeholder="e.g. Speak like a knowledgeable sommelier — confident, descriptive, and slightly poetic"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-right text-xs text-muted-foreground">{brandVoiceCustom.length}/300</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={isSaving}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving...
          </>
        ) : saved ? (
          <>
            <CheckCircle2 className="h-4 w-4" /> Saved!
          </>
        ) : (
          'Save brand profile'
        )}
      </button>
    </form>
  );
}
