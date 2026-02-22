'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Package, Trash2, Loader2 } from 'lucide-react';
import type { Product } from '@adavatar/types';

function buildFetcher(token: string) {
  return (url: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => j.data as Product[]);
}

function ProductCard({ product, onDelete }: { product: Product; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thumb = product.imageUrls[0];

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Thumbnail */}
      <div className="relative aspect-square overflow-hidden bg-muted">
        {thumb ? (
          <img src={thumb} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}

        {/* Image count badge */}
        {product.imageUrls.length > 1 && (
          <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white">
            +{product.imageUrls.length - 1}
          </span>
        )}

        {/* Delete btn */}
        <button
          type="button"
          disabled={deleting}
          onClick={async (e) => {
            e.stopPropagation();
            setDeleting(true);
            setError(null);
            try {
              onDelete(product.id);
            } catch {
              setError('Delete failed');
              setDeleting(false);
            }
          }}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
          aria-label="Delete product"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {product.imageUrls.length} image{product.imageUrls.length !== 1 ? 's' : ''}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function ProductGallery() {
  const { data: session } = useSession();

  const {
    data: products,
    mutate,
    isLoading,
  } = useSWR(
    session?.accessToken
      ? [`${process.env.NEXT_PUBLIC_API_URL}/api/products`, session.accessToken]
      : null,
    ([url, token]) => buildFetcher(token as string)(url),
    { refreshInterval: 30000 }
  );

  const handleDelete = async (id: string) => {
    if (!session?.accessToken) return;
    await mutate(
      async (prev) => {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/products/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error || 'Delete failed');
        }
        return prev?.filter((p) => p.id !== id);
      },
      { revalidate: false }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!products?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
        <Package className="mb-4 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No products yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add your first product to start generating ads.
        </p>
        <Link
          href="/dashboard/products/new"
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add Product
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onDelete={handleDelete} />
      ))}
    </div>
  );
}
