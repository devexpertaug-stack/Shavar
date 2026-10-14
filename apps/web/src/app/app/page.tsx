'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  api,
  type AnalyticsOverview,
  type AgentRow,
  type SourceRow,
} from '@/lib/api';

export default function DashboardPage() {
  const { user } = useAuth();
  const [ov, setOv] = useState<AnalyticsOverview | null>(null);
  const [funnel, setFunnel] = useState<{ stage: string; count: number }[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);

  const canSeeAnalytics = user && (user.role === 'OWNER' || user.role === 'SALES_MANAGER');

  useEffect(() => {
    if (!canSeeAnalytics) return;
    api.overview().then(setOv).catch(() => undefined);
    api.funnel().then(setFunnel).catch(() => undefined);
    api.agents().then(setAgents).catch(() => undefined);
    api.sources().then(setSources).catch(() => undefined);
  }, [canSeeAnalytics]);

  if (!user) return null;

  if (!canSeeAnalytics) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Welcome, {user.name || user.email}</h1>
        <p className="text-slate-600">Signed in as {user.role.replace('_', ' ')}.</p>
      </div>
    );
  }

  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Owner dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Total leads" value={ov?.totalLeads ?? '—'} />
        <Kpi label="Hot" value={ov?.byTier.HOT ?? 0} />
        <Kpi label="AI resolution" value={ov ? `${Math.round(ov.aiVsHuman.aiResolutionRate * 100)}%` : '—'} />
        <Kpi label="LLM cost" value={ov ? `$${ov.llm.costUsd.toFixed(4)}` : '—'} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Funnel</h2>
        <div className="space-y-2">
          {funnel.map((f) => (
            <div key={f.stage} className="flex items-center gap-3 text-sm">
              <span className="w-32 text-slate-600">{f.stage}</span>
              <div className="h-4 flex-1 rounded bg-slate-100">
                <div className="h-4 rounded bg-brand" style={{ width: `${(f.count / maxFunnel) * 100}%` }} />
              </div>
              <span className="w-8 text-right">{f.count}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Agent leaderboard</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr><th>Agent</th><th>Calls</th><th>Connects</th><th>Bookings</th></tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.userId} className="border-t border-slate-100">
                  <td className="py-1">{a.name}</td>
                  <td>{a.calls}</td>
                  <td>{a.connects}</td>
                  <td>{a.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Source ROI</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr><th>Source</th><th>Leads</th><th>Bookings</th><th>Cost/lead</th></tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source} className="border-t border-slate-100">
                  <td className="py-1">{s.source}</td>
                  <td>{s.leads}</td>
                  <td>{s.bookings}</td>
                  <td>₹{s.costPerLead.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <a href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/analytics/export/leads`} className="inline-block text-sm text-brand hover:underline">
        Export leads CSV →
      </a>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
