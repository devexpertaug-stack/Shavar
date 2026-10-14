'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { navForRole } from '@/lib/nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  }
  if (!user) return null;

  const items = navForRole(user.role);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-lg font-bold text-brand">EstateFlow</p>
          <p className="text-xs text-slate-500">{user.role.replace('_', ' ')}</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm font-medium ${
                  active ? 'bg-brand/10 text-brand' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium">{user.name || user.email}</p>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
          <button
            onClick={() => void logout()}
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-8">{children}</main>
    </div>
  );
}
