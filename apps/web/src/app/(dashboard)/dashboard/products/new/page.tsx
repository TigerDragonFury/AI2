import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ProductUploadForm } from '@/components/product/product-upload-form';

export const metadata = { title: 'New Product' };

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/dashboard/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Products
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Add New Product</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload product images. These will be used as the background in your ads.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <ProductUploadForm />
      </div>
    </div>
  );
}
