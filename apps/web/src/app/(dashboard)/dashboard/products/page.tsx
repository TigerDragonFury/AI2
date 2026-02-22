import { ShoppingBag } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Products' };

export default function ProductsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Products</h1>
                <a
                    href="/dashboard/products/new"
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    + Add Product
                </a>
            </div>
            <EmptyState
                icon={ShoppingBag}
                title="No products yet"
                description="Add your first product to start featuring it in ads."
                action={{ label: 'Add Product', href: '/dashboard/products/new' }}
            />
        </div>
    );
}
