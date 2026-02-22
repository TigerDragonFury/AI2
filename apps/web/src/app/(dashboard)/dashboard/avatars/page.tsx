import Link from 'next/link';
import { Plus } from 'lucide-react';
import { AvatarGallery } from '@/components/avatar/avatar-gallery';

export const metadata = { title: 'Avatars' };

export default function AvatarsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Avatars</h1>
        <Link
          href="/dashboard/avatars/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Avatar
        </Link>
      </div>
      <AvatarGallery />
    </div>
  );
}
