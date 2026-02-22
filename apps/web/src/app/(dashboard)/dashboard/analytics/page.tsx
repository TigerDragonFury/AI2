import { BarChart2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Analytics</h1>
            <EmptyState
                icon={BarChart2}
                title="No data yet"
                description="Publish some ads to start seeing performance data here."
                action={{ label: 'Create an Ad', href: '/dashboard/ads/create' }}
            />
        </div>
    );
}
