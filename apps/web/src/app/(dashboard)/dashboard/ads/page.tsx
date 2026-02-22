import { Film } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Ads' };

export default function AdsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Ads</h1>
                <a
                    href="/dashboard/ads/create"
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    + Generate Ad
                </a>
            </div>
            <EmptyState
                icon={Film}
                title="No ads yet"
                description="Create your first AI ad video using an avatar and product."
                action={{ label: 'Generate Ad', href: '/dashboard/ads/create' }}
            />
        </div>
    );
}
