'use client';

import { useEffect, useState } from 'react';
import type { HealthResponse } from '@estateflow/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function HealthBadge() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => !cancelled && setHealth(data))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-red-600">API unreachable: {error}</p>;
  if (!health) return <p className="text-slate-500">Checking…</p>;

  const color =
    health.status === 'ok'
      ? 'text-emerald-600'
      : health.status === 'degraded'
        ? 'text-amber-600'
        : 'text-red-600';

  return (
    <div className="space-y-2 text-sm">
      <p className={`font-semibold ${color}`}>API: {health.status.toUpperCase()}</p>
      <ul className="space-y-1 text-slate-600">
        <li>Database: {health.dependencies.database.status}</li>
        <li>Redis: {health.dependencies.redis.status}</li>
        <li>Uptime: {health.uptimeSeconds}s</li>
      </ul>
    </div>
  );
}
