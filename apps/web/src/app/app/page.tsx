'use client';

import { useAuth } from '@/lib/auth-context';
import { navForRole } from '@/lib/nav';

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const items = navForRole(user.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {user.name || user.email}</h1>
        <p className="text-slate-600">
          You are signed in as <strong>{user.role.replace('_', ' ')}</strong>.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Your workspace sections
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.href}
              className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
            >
              {item.label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
