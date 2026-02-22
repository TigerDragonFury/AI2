import { BarChart2, Film, Send, Users } from 'lucide-react';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function DashboardPage() {
    const session = await getServerSession(authOptions);

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold">
                    Welcome back{session?.user?.name ? `, ${session.user.name}` : ''}
                </h1>
                <p className="text-muted-foreground">Here&apos;s what&apos;s happening with your ads.</p>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                    { label: 'Avatars', icon: Users, value: '—', href: '/dashboard/avatars' },
                    { label: 'Ads Generated', icon: Film, value: '—', href: '/dashboard/ads' },
                    { label: 'Posts Published', icon: Send, value: '—', href: '/dashboard/published' },
                    { label: 'Total Views', icon: BarChart2, value: '—', href: '/dashboard/analytics' },
                ].map(({ label, icon: Icon, value, href }) => (
                    <Link
                        key={label}
                        href={href}
                        className="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/50"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                                <Icon className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{value}</p>
                                <p className="text-xs text-muted-foreground">{label}</p>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>

            {/* Getting started */}
            <div className="rounded-lg border border-border bg-card p-6">
                <h2 className="text-lg font-semibold">Get started</h2>
                <p className="mt-1 text-sm text-muted-foreground">Follow these steps to create your first ad.</p>
                <ol className="mt-4 space-y-3 text-sm">
                    {[
                        { step: '1', label: 'Upload an avatar', href: '/dashboard/avatars' },
                        { step: '2', label: 'Add a product', href: '/dashboard/products' },
                        { step: '3', label: 'Generate an ad', href: '/dashboard/ads' },
                        { step: '4', label: 'Connect a platform', href: '/dashboard/platforms' },
                        { step: '5', label: 'Publish your ad', href: '/dashboard/ads' },
                    ].map(({ step, label, href }) => (
                        <li key={step} className="flex items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                                {step}
                            </span>
                            <Link href={href} className="hover:underline">
                                {label}
                            </Link>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}
