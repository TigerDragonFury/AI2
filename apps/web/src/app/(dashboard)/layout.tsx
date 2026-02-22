import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const session = await getServerSession(authOptions);
    if (!session) redirect('/login');

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar user={session.user} />
            <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
        </div>
    );
}
