const STYLES: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700',
  WARM: 'bg-amber-100 text-amber-700',
  COLD: 'bg-slate-100 text-slate-600',
};

export function TierBadge({ tier, score }: { tier: string; score?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        STYLES[tier] ?? STYLES.COLD
      }`}
    >
      {tier}
      {typeof score === 'number' && <span className="opacity-70">· {score}</span>}
    </span>
  );
}
