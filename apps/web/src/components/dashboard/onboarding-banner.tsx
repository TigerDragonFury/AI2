'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { X, Sparkles } from 'lucide-react';

export function OnboardingBanner() {
  const { data: session } = useSession();
  const token = session?.accessToken as string | undefined;

  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Check session storage first so we don't flash on every navigation
    if (sessionStorage.getItem('onboardingBannerDismissed')) return;

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(({ data }) => {
        if (data && !data.onboardingDone) setShow(true);
      })
      .catch(() => {});
  }, [token]);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('onboardingBannerDismissed', '1');
    // Fade out after dismiss
    setTimeout(() => setShow(false), 300);
  };

  if (!show) return null;

  return (
    <div
      className={[
        'flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 transition-opacity duration-300',
        dismissed ? 'opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="flex-1">
        <p className="text-sm font-semibold">Complete your brand profile</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Add your company name, logo, and brand voice so the AI can generate personalised ad
          scripts and voiceovers.
        </p>
        <Link
          href="/dashboard/settings"
          className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          Set up brand profile →
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 hover:bg-primary/10"
      >
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}
