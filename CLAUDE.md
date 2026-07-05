# CLAUDE.md — agent briefing for epistemic-stack

Read `docs/ARCHITECTURE.md` before making non-trivial changes — it maps every subsystem to
its files. `README.md` covers human setup. This file is the working contract.

## What this is

A multiplayer epistemic commons: append-only, provenance-first claim graph built jointly by
people and the eve agent. Two invariants shape every design decision:

1. **Append-only.** Nothing in the commons is deleted or overwritten. Disagreement is recorded
   (challenges), never resolved by removal. State like "contested" is *derived*, not stored.
2. **Late-binding trust.** All writes are accepted with receipts (who/how/when); trust is
   applied at read time via lenses. Never add write-time gatekeeping.

## Layout

- `packages/web` — Next.js 16 app (`@epistack/web`). UI in `app/_components/`, server bits in
  `lib/`, the eve agent in `agent/` (mounted into the same process by `withEve()` in
  `next.config.ts` — there is no separate agent server).
- `packages/db` — Drizzle schema (`src/schema.ts`) + migrations (`drizzle/`) for the commons.

## Commands

```sh
bun install                                  # repo root; bun is the package manager everywhere
supabase start                               # local Postgres :54422 / API :54421 / Studio :54423
bun run db:migrate                           # apply migrations (repo root)
cd packages/web && bun run dev               # dev server (app + eve, one process)

# verification — run BOTH before considering work done:
cd packages/web && bunx tsc --noEmit && bunx biome check .
cd packages/db  && bunx tsc --noEmit && bunx biome check .
```

## Hard rules

- **Consult the user before adding ANY new dependency or external service.** This is a
  standing instruction from the repo owner. Use what's installed (radix-ui, @xyflow/react,
  d3-force, ai SDK, drizzle, supabase-js, lucide-react, tailwind v4, streamdown, cmdk, zod).
- **Node ≥ 24** for anything that boots eve (`.nvmrc` pins it). If `next dev` fails with an
  eve version error, the PATH is resolving an older Node.
- **Schema changes:** edit `packages/db/src/schema.ts`, then `bun run db:generate` (creates a
  numbered migration) and `bun run db:migrate`. Never hand-edit applied migrations; never
  renumber. Keep columns additive/nullable — existing commons data must survive.
- Lint is biome (root) / **ultracite** (web — stricter). Fix findings, don't suppress them,
  except with an explanatory `biome-ignore` when the rule is genuinely wrong for the case.

## Sharp edges (each has bitten before)

- **Supabase presence re-`track()` APPENDS metas** — always read `metas.at(-1)`, never `[0]`.
- **Graph layout must stay deterministic**: `layout()` in `graph-panel.tsx` sorts nodes/edges
  by id before d3-force. Cursors and tours broadcast *flow coordinates*; if layouts diverge
  between clients, remote cursors point at the wrong nodes.
- **Never call server actions during render** (Next 16 throws "Cannot update Router…").
  Render-time data goes through route handlers + `fetch`; client-only fetches need the
  `typeof window === "undefined"` suspend guard (see `app-shell.tsx`).
- **Identity is split on purpose**: `clientId` (per-tab, sessionStorage) keys cursors/presence
  connections; `userId` keys avatars/colors/attribution. See `lib/realtime/types.ts` doc
  comment before "simplifying" this.
- **eve streams, not responses**: room members ingest the durable session stream
  (`RoomStore`); the sender never iterates its own POST response. Don't "fix" that.
- **Don't import `agent/lib/*` into Next server code** — it drags `@huggingface/transformers`
  / onnxruntime into the bundle. Route handlers may use it only because those packages are in
  Next's `serverExternalPackages`. Shared constants (e.g. the eve contributor id) are
  duplicated deliberately (see `lib/comments.ts`).
- **Tailwind v4 `data-active:` matches attribute presence** — pass `data-active={x || undefined}`,
  never `data-active={false}`.
- **`createDb()` is a globalThis-cached singleton** (pool max 6). Never construct raw
  `postgres()` clients in web code; dev hot-reload will exhaust local Postgres connections.

## Feature → file map (details in docs/ARCHITECTURE.md)

| Feature | Entry points |
| --- | --- |
| Room/chat/eve streaming | `lib/room/room-store.ts`, `app/_components/room-provider.tsx`, `app-shell.tsx` |
| Presence, cursors, cursor chat | `hooks/use-room-channel.ts`, `app/_components/presence/cursor-layer.tsx` |
| @eve answers/tours | `app/_components/presence/use-tour.ts`, `app/api/tour/route.ts` |
| Delegated investigations | `lib/delegate/`, `app/api/delegate/`, `app/_components/delegate/` |
| Graph panel + payload | `lib/graph-data.ts`, `app/_components/graph-panel.tsx`, `app/_components/graph/` |
| Lenses (late-binding trust) | `lib/lenses/`, `app/_components/lenses/` |
| Comments (highlight→thread) | `app/_components/comments/`, `lib/comments.ts`, `app/(chat)/comment-actions.ts` |
| Challenges + receipts | `lib/challenges.ts`, `lib/challenge-types.ts`, `app/_components/challenges/`, `app/(chat)/challenge-actions.ts` |
| Commons search + seeding | `lib/commons-search.ts`, `app/api/commons/` |
| Credences / belief timeline | `lib/credences.ts`, `app/_components/graph/credence-section.tsx`, time slider in `graph-panel.tsx` |
| eve agent + tools | `agent/agent.ts`, `agent/instructions.md`, `agent/tools/*.ts`, `agent/lib/commons.ts` |
| People layer (person cards, follow, lens adopt, belief compare) | `app/_components/people/`, `app/(chat)/people-actions.ts`, `lib/people.ts` |
| Realtime wire protocol | `lib/realtime/types.ts` (event catalog, identity model) |
