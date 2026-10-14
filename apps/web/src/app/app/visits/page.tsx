'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type SiteVisit } from '@/lib/api';

export default function VisitsPage() {
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.visits().then(setVisits).catch((e) => setError(String(e)));
  }, []);
  useEffect(reload, [reload]);

  function geo(): Promise<string> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve('0,0');
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(`${p.coords.latitude},${p.coords.longitude}`),
        () => resolve('0,0'),
      );
    });
  }

  async function checkIn(id: string) {
    await api.checkIn(id, await geo());
    reload();
  }
  async function checkOut(id: string) {
    const feedback = window.prompt('Visit feedback?') ?? undefined;
    await api.checkOut(id, await geo(), feedback);
    reload();
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Site visits</h1>
      {error && <p className="text-red-600">{error}</p>}
      {visits.length === 0 && <p className="text-slate-500">No visits scheduled.</p>}
      {visits.map((v) => (
        <div key={v.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{v.lead?.contact.name ?? v.lead?.contact.phoneE164}</p>
              <p className="text-xs text-slate-500">{new Date(v.slotAt).toLocaleString()}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{v.status}</span>
          </div>
          <div className="mt-3 flex gap-2">
            {v.status === 'SCHEDULED' || v.status === 'CONFIRMED' ? (
              <button onClick={() => checkIn(v.id)} className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-dark">
                GPS Check in
              </button>
            ) : v.status === 'CHECKED_IN' ? (
              <button onClick={() => checkOut(v.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                Check out + feedback
              </button>
            ) : (
              <span className="text-sm text-slate-500">{v.feedback ? `“${v.feedback}”` : 'Done'}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
