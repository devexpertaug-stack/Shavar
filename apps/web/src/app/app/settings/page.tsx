'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, type ProviderSummary } from '@/lib/api';

const PROVIDER_TYPES = ['MOCK', 'WATI', 'AISENSY', 'META_CLOUD'];

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [type, setType] = useState('WATI');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function reload() {
    api.providers().then(setProviders).catch((e) => setError(String(e)));
  }
  useEffect(reload, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api.upsertProvider({ type, apiKey, baseUrl, webhookSecret });
      setApiKey('');
      setWebhookSecret('');
      setSaved(true);
      reload();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">WhatsApp providers</h1>
      <p className="text-sm text-slate-600">
        Connect a WhatsApp Business provider. Credentials are encrypted at rest. Point the
        provider&apos;s webhook at the URL shown after saving.
      </p>

      <form onSubmit={onSave} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Provider</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5"
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://live.wati.io" />
          <Field label="API key" value={apiKey} onChange={setApiKey} placeholder="••••••" />
          <Field
            label="Webhook secret"
            value={webhookSecret}
            onChange={setWebhookSecret}
            placeholder="shared secret"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-emerald-600">Saved.</p>}
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          Save provider
        </button>
      </form>

      <div className="space-y-3">
        {providers.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{p.type}</h3>
              <button
                onClick={() => api.deleteProvider(p.id).then(reload)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
            <p className="mt-2 break-all text-xs text-slate-500">
              Webhook URL: <code className="text-slate-700">{p.webhookUrl}</code>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              API key {p.hasApiKey ? '✓ set' : '— not set'} · Secret{' '}
              {p.hasWebhookSecret ? '✓ set' : '— not set'}
            </p>
          </div>
        ))}
        {providers.length === 0 && <p className="text-sm text-slate-500">No providers yet.</p>}
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{props.label}</span>
      <input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5"
      />
    </label>
  );
}
