# epistemic-stack

A multiplayer **epistemic commons**: a shared, append-only, provenance-first claim graph that
people and AI agents build together. Investigations are real-time collaborative rooms (live
cursors, shared chats with the agent **eve**, guided graph tours, comments, challenges), and
everything anyone records — claims, sources, hypotheses, disputes, beliefs — lands in one
common graph with full receipts. Trust is applied at **read time** through lenses, never
enforced at write time.

Built for the FLF Epistemic Stack competition.

- **Deep technical map:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **LLM/agent briefing (auto-loaded by Claude Code):** [`CLAUDE.md`](CLAUDE.md)

## Stack

Bun workspaces monorepo · Next.js 16 (React 19) · [eve](https://eve.dev) agent framework ·
Supabase (Postgres + Auth + Realtime) · Drizzle ORM · Tailwind v4 · @xyflow/react + d3-force.

| Package | What it is |
| --- | --- |
| `packages/web` (`@epistack/web`) | The Next.js app — UI, the eve agent (`agent/`), all multiplayer features |
| `packages/db` (`@epistack/db`) | Drizzle schema + migrations for the commons |

## Prerequisites

- **[Bun](https://bun.sh)** — package manager and script runner for everything.
- **Node.js ≥ 24** — eve requires it. `.nvmrc` pins `24`; run `nvm use` (or
  `nvm alias default 24`). If the dev server prints *"eve requires Node.js >=24"*, your PATH
  is resolving an older Node.
- **[Supabase CLI](https://supabase.com/docs/guides/local-development)** + Docker — the local
  database, auth, and realtime stack.

## Setup

```sh
git clone <this repo> && cd epistemic-stack
bun install

# 1. Start local Supabase (Postgres :54422, API :54421, Studio :54423, mail :54424)
supabase start

# 2. Configure env
cp packages/web/.env.example packages/web/.env
#    → fill in the keys (see table below; supabase start prints the local values)

# 3. Apply database migrations
bun run db:migrate

# 4. Run the app (from packages/web)
cd packages/web && bun run dev
```

Open http://localhost:3000, sign in (local auth emails are caught by the mail sandbox at
http://localhost:54424 — nothing is actually sent), ask a question, and pop open the graph.

**Multiplayer in one sentence:** open the same investigation URL (`/i/<id>`) in a second
browser/profile with a second account — cursors, presence avatars, tours, comments, and
challenges are all live between them.

## Environment keys (`packages/web/.env`)

| Variable | Required | What / where to get it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Local: `http://127.0.0.1:54421` (printed by `supabase start`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Printed by `supabase start` (`anon key`) |
| `SUPABASE_SECRET_KEY` | yes | Printed by `supabase start` (`service_role key`) |
| `POSTGRES_URL` | yes | Local: `postgresql://postgres:postgres@127.0.0.1:54422/postgres` |
| `WORKFLOW_POSTGRES_URL` | yes | eve's durable session log — same local Postgres URL is fine |
| `WORKFLOW_TARGET_WORLD` | yes | `@workflow/world-postgres` (literal) |
| `WORKFLOW_QUEUE_NAMESPACE` | yes | Any short name, e.g. `eve` |
| `ANTHROPIC_API_KEY` | yes* | [console.anthropic.com](https://console.anthropic.com) — powers eve, tours, delegated investigations |
| `TAVILY_API_KEY` | recommended | [tavily.com](https://tavily.com) — eve's web search; without it, delegated investigations can't add *sourced* claims (they degrade to structure-only) |

\* The helper model (`packages/web/lib/eve-model.ts`) falls back to OpenAI (`OPENAI_API_KEY`)
if no Anthropic key is set.

## Everyday commands

```sh
# from repo root
bun run check              # biome lint across the monorepo
bun run db:generate        # drizzle-kit: generate a migration after editing packages/db/src/schema.ts
bun run db:migrate         # apply migrations

# from packages/web
bun run dev                # next dev (serves the app AND the eve agent — one process)
bun run check              # ultracite (stricter biome preset for the web package)
bunx tsc --noEmit          # typecheck
```

There is no separate agent server: `next.config.ts` wraps the app with `withEve()`, which
mounts the agent in `packages/web/agent/` into the same dev server under `/eve/v1/*`.
