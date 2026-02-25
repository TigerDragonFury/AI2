import { BrandProfileForm } from '@/components/settings/brand-profile-form';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your brand profile and account.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-6">
          <h2 className="text-base font-semibold">Brand Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This information is used by the AI to personalise ad scripts and voiceovers.
          </p>
        </div>
        <BrandProfileForm />
      </div>
    </div>
  );
}
