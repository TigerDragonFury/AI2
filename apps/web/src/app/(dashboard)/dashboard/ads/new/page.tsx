import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { AdCreatorWizard } from '@/components/ads/ad-creator-wizard';

export const metadata = { title: 'Create Ad' };

export default function NewAdPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/dashboard/ads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Ads
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Create New Ad</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select an avatar and product, then describe your ad. AI will generate a short video.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <AdCreatorWizard />
      </div>
    </div>
  );
}
