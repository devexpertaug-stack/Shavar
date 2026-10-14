'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Campaign, type Template } from '@/lib/api';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [tier, setTier] = useState('WARM');
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.campaigns().then(setCampaigns).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    reload();
    api.templates().then(setTemplates).catch(() => undefined);
  }, [reload]);

  const segment = () => (tier ? { tier } : {});

  async function doPreview() {
    const res = await api.previewSegment(segment());
    setPreview(res.count);
  }

  async function create() {
    setError(null);
    try {
      await api.createCampaign({ name, templateName, segment: segment() });
      setName('');
      reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function send(id: string) {
    const res = await api.sendCampaign(id);
    alert(`Queued ${res.recipients} recipients`);
    reload();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Campaigns</h1>
      {error && <p className="text-red-600">{error}</p>}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">New broadcast</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          <select value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">Choose template…</option>
            {templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">All tiers</option>
            <option value="HOT">Hot</option>
            <option value="WARM">Warm</option>
            <option value="COLD">Cold</option>
          </select>
          <button onClick={doPreview} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            Preview audience {preview != null ? `(${preview})` : ''}
          </button>
        </div>
        <button onClick={create} disabled={!name || !templateName} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
          Create campaign
        </button>
      </div>

      <div className="space-y-3">
        {campaigns.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-slate-500">template: {c.templateName} · {c.status}</p>
            </div>
            {c.status === 'DRAFT' && (
              <button onClick={() => send(c.id)} className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-dark">
                Send
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
