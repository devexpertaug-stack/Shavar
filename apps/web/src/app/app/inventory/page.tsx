'use client';

import { useEffect, useState } from 'react';
import { api, type InventoryProject, type InventoryUnit } from '@/lib/api';

export default function InventoryPage() {
  const [projects, setProjects] = useState<InventoryProject[]>([]);
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.projectsList().then(setProjects).catch((e) => setError(String(e)));
    api.units().then(setUnits).catch((e) => setError(String(e)));
  }, []);

  const inr = (n: number) => `₹${(n / 100000).toFixed(1)}L`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Inventory</h1>
      {error && <p className="text-red-600">{error}</p>}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Projects ({projects.length})
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-slate-500">{p.location}</p>
              <p className="mt-1 text-xs text-slate-400">{p.amenities.join(' · ')}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Units ({units.length})
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Unit</th>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">BHK</th>
                <th className="px-4 py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2 text-slate-600">{u.project?.name}</td>
                  <td className="px-4 py-2">{u.bhk}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {inr(u.priceMin)} – {inr(u.priceMax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
