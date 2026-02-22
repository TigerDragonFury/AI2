import Link from 'next/link';
import { Plus } from 'lucide-react';
import { AdGallery } from '@/components/ads/ad-gallery';

export const metadata = { title: 'Ads' };

export default function AdsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ads</h1>
        <Link
          href="/dashboard/ads/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Create Ad
        </Link>
      </div>
      <AdGallery />
    </div>
  );
}
