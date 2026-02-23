'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  Users,
  ShoppingBag,
  Film,
  Send,
  BarChart2,
  Share2,
  Settings,
  LogOut,
  Activity,
  ShieldCheck,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationsDropdown } from '@/components/notifications/notifications-dropdown';

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string | null;
  };
}

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/avatars', icon: Users, label: 'Avatars' },
  { href: '/dashboard/products', icon: ShoppingBag, label: 'Products' },
  { href: '/dashboard/ads', icon: Film, label: 'Ads' },
  { href: '/dashboard/published', icon: Send, label: 'Published' },
  { href: '/dashboard/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/dashboard/platforms', icon: Share2, label: 'Platforms' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
  { href: '/dashboard/usage', icon: Activity, label: 'Usage' },
];

const adminItems = [
  { href: '/admin/tiers', icon: ShieldCheck, label: 'Tier Limits' },
  { href: '/admin/settings', icon: Bot, label: 'AI Settings' },
];

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = user.role === 'admin';

  return (
    <aside className="flex h-full w-16 flex-col items-center border-r border-border bg-card py-4 lg:w-56 lg:items-start lg:px-3">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-2 px-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
          A
        </div>
        <span className="hidden text-lg font-bold lg:block">AdAvatar</span>
      </div>

      {/* Nav */}
      <nav className="flex w-full flex-1 flex-col gap-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive =
            pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Admin */}
      {isAdmin && (
        <>
          <div className="my-2 border-t border-border" />
          <p className="mb-1 hidden px-2 text-xs font-semibold uppercase text-muted-foreground lg:block">
            Admin
          </p>
          {adminItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="hidden lg:block">{label}</span>
              </Link>
            );
          })}
        </>
      )}

      {/* User + logout */}
      <div className="w-full border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between px-2">
          <NotificationsDropdown />
        </div>
        <div className="mb-2 flex items-center gap-2 px-2">
          {user.image ? (
            <img src={user.image} alt={user.name ?? 'User'} className="h-7 w-7 rounded-full" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {user.name?.[0] ?? user.email?.[0] ?? '?'}
            </div>
          )}
          <div className="hidden flex-1 overflow-hidden lg:block">
            <p className="truncate text-xs font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span className="hidden lg:block">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
