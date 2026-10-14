'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type LeadDetail, type PipelineStage, type WaMessage, type MatchedUnit } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { TierBadge } from '@/components/tier-badge';

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [note, setNote] = useState('');
  const [liveMessages, setLiveMessages] = useState<WaMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .lead(id)
      .then(setLead)
      .catch((e) => setError(String(e)));
  }, [id]);

  useEffect(() => {
    reload();
    api.stages().then(setStages).catch(() => undefined);
  }, [reload]);

  // Live-subscribe to new WhatsApp messages for this lead (Task 4 realtime).
  useEffect(() => {
    const socket = getSocket();
    const onNew = (msg: WaMessage) => {
      if (msg.leadId === id) setLiveMessages((prev) => [msg, ...prev]);
    };
    socket.emit('lead:subscribe', id);
    socket.on('message:new', onNew);
    return () => {
      socket.emit('lead:unsubscribe', id);
      socket.off('message:new', onNew);
    };
  }, [id]);

  async function onStageChange(stage: string) {
    setError(null);
    let lostReason: string | undefined;
    if (stage === 'Lost') {
      lostReason = window.prompt('Reason for marking this lead as Lost?') ?? undefined;
      if (!lostReason) return;
    }
    try {
      await api.changeStage(id, stage, lostReason);
      reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onAddNote() {
    if (!note.trim()) return;
    await api.addNote(id, note.trim());
    setNote('');
    reload();
  }

  if (error && !lead) return <p className="text-red-600">{error}</p>;
  if (!lead) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">{lead.contact.name ?? 'Unknown'}</h1>
            <TierBadge tier={lead.tier} score={lead.score} />
          </div>
          <p className="mt-1 text-slate-600">{lead.contact.phoneE164}</p>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Source" value={lead.source} />
            <Row label="Stage" value={lead.stage} />
            {lead.lostReason && <Row label="Lost reason" value={lead.lostReason} />}
          </dl>
        </div>

        <QualificationPanel qualification={lead.qualification} />
        <MatchedUnitsPanel leadId={id} />

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Move to stage
          </h2>
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <button
                key={s.id}
                disabled={s.name === lead.stage}
                onClick={() => onStageChange(s.name)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  s.name === lead.stage
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-slate-300 hover:bg-slate-50'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Add a note
          </h2>
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Type a note…"
              className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <button
              onClick={onAddNote}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Add
            </button>
          </div>
        </div>

        {liveMessages.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-700">
              Live messages
            </h2>
            <ul className="space-y-2">
              {liveMessages.map((m) => (
                <li key={m.id} className="rounded-md bg-white px-3 py-2 text-sm shadow-sm">
                  <span className="mr-2 text-xs font-semibold text-slate-400">{m.direction}</span>
                  {m.body ?? `[${m.type}]`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Timeline
          </h2>
          <ol className="space-y-3">
            {lead.activities.map((a) => (
              <li key={a.id} className="border-l-2 border-slate-200 pl-3">
                <p className="text-sm font-medium">{formatActivity(a.type, a.payload)}</p>
                <p className="text-xs text-slate-400">
                  {new Date(a.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function MatchedUnitsPanel({ leadId }: { leadId: string }) {
  const [units, setUnits] = useState<MatchedUnit[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    api.matchUnits(leadId).then(setUnits).catch(() => undefined);
  }, [leadId]);
  if (units.length === 0) return null;
  const inr = (n: number) => `₹${(n / 100000).toFixed(1)}L`;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Matched units
      </h2>
      <ul className="space-y-2">
        {units.map((u) => (
          <li key={u.id} className="rounded-md border border-slate-100 p-3 text-sm">
            <p className="font-medium">
              {u.projectName} · {u.name}
            </p>
            <p className="text-xs text-slate-500">
              {u.bhk}BHK · {u.location} · {inr(u.priceMin)}–{inr(u.priceMax)}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => api.sendUnit(leadId, u.id, 'brochure').then(() => setSent(u.id))}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
              >
                Send brochure
              </button>
              <button
                onClick={() => api.sendUnit(leadId, u.id, 'location').then(() => setSent(u.id))}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
              >
                Send location
              </button>
              {sent === u.id && <span className="text-xs text-emerald-600">queued ✓</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QualificationPanel({ qualification }: { qualification: Record<string, unknown> }) {
  const q = qualification ?? {};
  const intent = q.intent as string | undefined;
  if (!intent) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        No AI qualification yet.
      </div>
    );
  }
  const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '—' : String(v));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        AI qualification
      </h2>
      <dl className="space-y-2 text-sm">
        <Row label="Intent" value={fmt(q.intent)} />
        <Row label="BHK" value={fmt(q.bhk)} />
        <Row label="Budget" value={`${fmt(q.budget_min)} – ${fmt(q.budget_max)}`} />
        <Row label="Locations" value={fmt(q.locations)} />
        <Row label="Timeline" value={fmt(q.timeline)} />
        <Row label="Financing" value={fmt(q.financing)} />
        <Row label="Site visit" value={q.site_visit_interest ? 'Yes' : 'No'} />
        <Row label="Confidence" value={fmt(q.confidence)} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function formatActivity(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'NOTE':
      return `Note: ${String(payload.body ?? '')}`;
    case 'STAGE_CHANGE':
      return `Stage changed ${String(payload.from ?? '?')} → ${String(payload.to ?? '?')}`;
    case 'ASSIGNMENT':
      return payload.to ? 'Lead assigned' : 'Lead unassigned';
    case 'ENQUIRY':
      return String(payload.note ?? 'Enquiry');
    default:
      return type;
  }
}
