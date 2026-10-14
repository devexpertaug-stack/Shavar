'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type LeadListResponse, type PipelineStage } from '@/lib/api';
import { TierBadge } from '@/components/tier-badge';

export default function LeadsPage() {
  const [data, setData] = useState<LeadListResponse | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [stage, setStage] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stages().then(setStages).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (stage) params.set('stage', stage);
    if (tier) params.set('tier', tier);
    if (search) params.set('search', search);
    api
      .leads(params.toString())
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [stage, tier, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leads</h1>
        <Link
          href="/app/leads/board"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Kanban view →
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All tiers</option>
          <option value="HOT">Hot</option>
          <option value="WARM">Warm</option>
          <option value="COLD">Cold</option>
        </select>
      </div>

      {error && <p className="text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Stage</th>
              <th className="px-4 py-2">Tier</th>
              <th className="px-4 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((lead) => (
              <tr key={lead.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/app/leads/${lead.id}`} className="font-medium text-brand">
                    {lead.contact.name ?? 'Unknown'}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">{lead.contact.phoneE164}</td>
                <td className="px-4 py-2">{lead.stage}</td>
                <td className="px-4 py-2">
                  <TierBadge tier={lead.tier} score={lead.score} />
                </td>
                <td className="px-4 py-2 text-slate-600">{lead.source}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No leads match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <p className="text-sm text-slate-500">
          {data.total} lead{data.total === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}
