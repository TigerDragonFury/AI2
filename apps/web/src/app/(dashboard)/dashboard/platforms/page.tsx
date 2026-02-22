import { Suspense } from 'react';
import { PlatformConnectList } from '@/components/platforms/platform-connect-list';
import { Loader2 } from 'lucide-react';

export const metadata = { title: 'Connected Platforms' };

export default function PlatformsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Connected Platforms</h1>
        <p className="text-sm text-muted-foreground">
          Connect social accounts to publish your ads.
        </p>
      </div>
      <Suspense fallback={<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}>
        <PlatformConnectList />
      </Suspense>
    </div>
  );
}
