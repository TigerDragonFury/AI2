import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { PublishForm } from '@/components/publish/publish-form';

export const metadata = { title: 'Publish Ad' };

export default async function PublishAdPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) redirect('/login');

  // Fetch ad from API
  const res = await fetch(`${process.env.API_BASE_URL}/api/ads/${params.id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });

  if (!res.ok) notFound();

  const { data: ad } = await res.json();

  if (ad.status !== 'ready') {
    redirect(`/dashboard/ads?error=ad_not_ready`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/dashboard/ads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Ads
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Publish Ad</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select platforms to publish to and write your caption.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <PublishForm adId={params.id} videoUrl={ad.generatedVideoUrl} />
      </div>
    </div>
  );
}
