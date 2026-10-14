'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type LeadDetail, type PipelineStage } from '@/lib/api';
import { TierBadge } from '@/components/tier-badge';

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [note, setNote] = useState('');
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
