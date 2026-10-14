# EstateFlow — AI WhatsApp CRM for Real Estate

Multi-tenant, always-online CRM that replies to WhatsApp enquiries with AI within
seconds, qualifies and scores leads automatically, and routes them to the right
person. See the PRD for the full product scope.

> **Status:** Task 1 complete — monorepo skeleton, CI, and health check. The
> build follows the PRD's test-driven task order (Tasks 1–17).

## Architecture / stack

| Area        | Choice                                                             |
| ----------- | ------------------------------------------------------------------ |
| Monorepo    | pnpm workspaces + Turborepo                                        |
| `apps/web`  | Next.js 14 (App Router), TypeScript, Tailwind, TanStack Query      |
| `apps/api`  | NestJS 10, Prisma, Swagger/OpenAPI                                 |
| `apps/worker` | NestJS-standalone-style runner + BullMQ workers                  |
| `packages/shared` | Zod schemas and shared types (qualification JSON, roles, …)  |
| `packages/eslint-config` | Shared ESLint config                                  |
| Data        | PostgreSQL 16 + pgvector, Redis 7                                  |
| Tests       | Vitest (unit + e2e)                                               |
| CI          | GitHub Actions (lint, typecheck, tests, migrations, e2e)          |

## Prerequisites

- Node.js >= 20, pnpm 9
- Docker (for local Postgres + Redis)

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env and adjust as needed
cp .env.example .env

# 3. Start Postgres (with pgvector) + Redis
pnpm docker:up

# 4. Generate the Prisma client and apply migrations
pnpm db:generate
pnpm db:migrate

# 5. Seed a demo tenant
pnpm db:seed

# 6. Run everything (web :3000, api :4000, worker)
pnpm dev
```

### Health check

`GET /health` probes Postgres and Redis and returns an aggregated status:

```bash
curl -s http://localhost:4000/health | jq
```

```jsonc
{
  "status": "ok",            // ok | degraded | error
  "uptimeSeconds": 42,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "version": "0.1.0",
  "dependencies": {
    "database": { "status": "up", "latencyMs": 3 },
    "redis": { "status": "up", "latencyMs": 1 }
  }
}
```

Returns HTTP `200` when fully healthy and `503` when any dependency is down, so
uptime monitors can alert. The web app's home page renders this status live.

## Scripts

| Command           | Description                                       |
| ----------------- | ------------------------------------------------- |
| `pnpm dev`        | Run web, api, and worker in watch mode            |
| `pnpm build`      | Build all packages                                |
| `pnpm lint`       | ESLint across the monorepo                        |
| `pnpm typecheck`  | `tsc --noEmit` across the monorepo                |
| `pnpm test`       | Unit tests (Vitest)                               |
| `pnpm format`     | Prettier write                                    |
| `pnpm docker:up`  | Start Postgres + Redis                            |
| `pnpm db:migrate` | Run Prisma migrations                             |
| `pnpm db:seed`    | Seed demo data                                    |

## Repository layout

```
estateflow/
├─ apps/
│  ├─ api/        # NestJS REST API (/api/v1), Swagger at /api/docs, /health
│  ├─ web/        # Next.js app
│  └─ worker/     # BullMQ workers (inbound, ai, scoring, routing, …)
├─ packages/
│  ├─ shared/        # Zod schemas + shared types
│  └─ eslint-config/ # Shared lint config
├─ docker/           # Postgres init (pgvector + pgcrypto)
├─ docker-compose.yml
└─ turbo.json
```

## Task roadmap

Built in PRD order: **1. Monorepo + health ✅** · 2. Auth + RBAC · 3. Leads +
pipeline · 4. WhatsApp inbound · 5. Chat inbox · 6. LLM qualification ·
7. Scoring · 8. Routing + SLA · 9. Inventory matching · 10. AI auto-reply ·
11. Voice/multilingual · 12. Tele-caller workspace · 13. Site visits ·
14. Lead sources · 15. Campaigns · 16. Owner analytics · 17. Hardening + deploy.
```
