import { HealthBadge } from '@/components/health-badge';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-3">
        <span className="inline-block rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand">
          v0.1 — scaffold
        </span>
        <h1 className="text-4xl font-bold tracking-tight">EstateFlow</h1>
        <p className="text-lg text-slate-600">
          AI WhatsApp CRM for Real Estate. Reply in seconds, qualify automatically, score and route
          every lead.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          System status
        </h2>
        <HealthBadge />
      </section>

      <a
        href="/login"
        className="inline-block w-fit rounded-md bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-dark"
      >
        Sign in →
      </a>
    </main>
  );
}
