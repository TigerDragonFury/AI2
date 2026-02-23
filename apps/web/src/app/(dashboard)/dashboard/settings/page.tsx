export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account settings and profile.
        </p>
        <div className="mt-4 space-y-1 text-sm text-muted-foreground">
          <p>Profile editing coming soon.</p>
          <p>Password change coming soon.</p>
          <p>Subscription management coming soon.</p>
        </div>
      </div>
    </div>
  );
}
