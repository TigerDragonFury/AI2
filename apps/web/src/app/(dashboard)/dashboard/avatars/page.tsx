import { Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Avatars' };

export default function AvatarsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Avatars</h1>
                <a
                    href="/dashboard/avatars/new"
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    + Create New
                </a>
            </div>
            <EmptyState
                icon={Users}
                title="No avatars yet"
                description="Upload a photo or video to create your first AI avatar."
                action={{ label: 'Upload Avatar', href: '/dashboard/avatars/new' }}
            />
        </div>
    );
}
