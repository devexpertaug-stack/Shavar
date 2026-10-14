'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type QueueCard } from '@/lib/api';
import { TierBadge } from '@/components/tier-badge';

const OUTCOMES = ['connected', 'no_answer', 'callback', 'not_interested', 'visit_booked'];

export default function QueuePage() {
  const [queue, setQueue] = useState<QueueCard[]>([]);
  const [activeCall, setActiveCall] = useState<{ callId: string; leadId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.nextBestCalls().then(setQueue).catch((e) => setError(String(e)));
  }, []);
  useEffect(reload, [reload]);

  async function call(leadId: string) {
    setError(null);
    try {
      const res = await api.clickToCall(leadId, '+919800000000');
      setActiveCall({ callId: res.id, leadId });
    } catch (e) {
      setError(String(e));
    }
  }

  async function logOutcome(outcome: string) {
    if (!activeCall) return;
    const next = outcome === 'callback' || outcome === 'no_answer' ? new Date(Date.now() + 86400000).toISOString() : undefined;
    await api.callOutcome(activeCall.callId, outcome, next);
    setActiveCall(null);
    reload(); // next lead surfaces
  }

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">Next Best Call</h1>
      {error && <p className="text-red-600">{error}</p>}

      {queue.length === 0 && <p className="text-slate-500">Your queue is clear. 🎉</p>}

      {queue.map((c, i) => (
        <div
          key={c.leadId}
          className={`rounded-xl border bg-white p-5 ${i === 0 ? 'border-brand shadow-sm' : 'border-slate-200'}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{c.contact.name ?? c.contact.phoneE164}</p>
              <p className="text-xs text-slate-500">{c.contact.phoneE164}</p>
            </div>
            <TierBadge tier={c.tier} score={c.score} />
          </div>
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            {c.brief}
          </pre>
          {i === 0 && !activeCall && (
            <button
              onClick={() => call(c.leadId)}
              className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              📞 Call now
            </button>
          )}
          {activeCall?.leadId === c.leadId && (
            <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">Log the outcome (required):</p>
              <div className="flex flex-wrap gap-2">
                {OUTCOMES.map((o) => (
                  <button
                    key={o}
                    onClick={() => logOutcome(o)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50"
                  >
                    {o.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
