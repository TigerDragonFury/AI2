import { Send } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Published' };

export default function PublishedPage() {
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Published Posts</h1>
            <EmptyState
                icon={Send}
                title="No published posts"
                description="Generate an ad and publish it to a connected social platform."
                action={{ label: 'Create an Ad', href: '/dashboard/ads/create' }}
            />
        </div>
    );
}
