'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type BoardResponse, type LeadSummary } from '@/lib/api';
import { TierBadge } from '@/components/tier-badge';

export default function BoardPage() {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [dragging, setDragging] = useState<LeadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .board()
      .then(setBoard)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => reload(), [reload]);

  async function onDrop(stage: string) {
    if (!dragging || dragging.stage === stage) {
      setDragging(null);
      return;
    }
    const lead = dragging;
    setDragging(null);
    setError(null);

    let lostReason: string | undefined;
    if (stage === 'Lost') {
      lostReason = window.prompt(`Reason for marking "${lead.contact.name}" as Lost?`) ?? undefined;
      if (!lostReason) return;
    }

    // Optimistic move.
    setBoard((prev) => moveLeadLocally(prev, lead.id, stage));
    try {
      await api.changeStage(lead.id, stage, lostReason);
      reload();
    } catch (e) {
      setError(String(e));
      reload(); // revert to server truth
    }
  }

  if (error && !board) return <p className="text-red-600">{error}</p>;
  if (!board) return <p className="text-slate-500">Loading board…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <Link
          href="/app/leads"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          List view →
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {board.columns.map((col) => (
          <div
            key={col.stage}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(col.stage)}
            className="flex w-72 flex-shrink-0 flex-col rounded-xl bg-slate-100 p-3"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">{col.stage}</h2>
              <span className="rounded-full bg-white px-2 text-xs text-slate-500">
                {col.leads.length}
              </span>
            </div>
            <div className="space-y-2">
              {col.leads.map((lead) => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={() => setDragging(lead)}
                  className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/app/leads/${lead.id}`}
                      className="text-sm font-medium text-brand"
                    >
                      {lead.contact.name ?? 'Unknown'}
                    </Link>
                    <TierBadge tier={lead.tier} score={lead.score} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{lead.contact.phoneE164}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function moveLeadLocally(
  board: BoardResponse | null,
  leadId: string,
  toStage: string,
): BoardResponse | null {
  if (!board) return board;
  let moved: LeadSummary | undefined;
  const stripped = board.columns.map((c) => ({
    ...c,
    leads: c.leads.filter((l) => {
      if (l.id === leadId) {
        moved = { ...l, stage: toStage };
        return false;
      }
      return true;
    }),
  }));
  if (!moved) return board;
  return {
    ...board,
    columns: stripped.map((c) =>
      c.stage === toStage ? { ...c, leads: [moved!, ...c.leads] } : c,
    ),
  };
}
