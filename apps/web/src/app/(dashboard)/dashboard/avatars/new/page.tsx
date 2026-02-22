import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { AvatarUploadForm } from '@/components/avatar/avatar-upload-form';

export const metadata = { title: 'New Avatar' };

export default function NewAvatarPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Back nav */}
      <Link
        href="/dashboard/avatars"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Avatars
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Create New Avatar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a photo or short video. Our AI will process it into a reusable avatar.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <AvatarUploadForm />
      </div>
    </div>
  );
}
