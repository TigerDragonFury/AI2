import { PublishedPostsList } from '@/components/publish/published-posts-list';

export const metadata = { title: 'Published' };

export default function PublishedPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Published Posts</h1>
      <PublishedPostsList />
    </div>
  );
}
