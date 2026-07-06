# Architecture

Technical map of epistemic-stack. Written to be parseable by humans and coding agents alike:
every subsystem lists its files, its data flow, and the invariants you must not break.

## 1. The idea in one paragraph

Investigations are chat rooms where teams work through open questions with **eve** (an AI
research agent). Everything eve or a person records — claims, sources, hypotheses, cruxes,
relations — is appended to one shared **commons**: a provenance-first claim graph spanning all
investigations. Nothing is ever deleted or moderated away; disagreement is stored as
**challenges**, belief is stored as time-stamped **credences**, and trust is a **read-time**
concern (every node carries its provenance receipt; see §7.3). Rooms are fully
multiplayer: durable shared eve sessions, live cursors, guided tours, delegated background
investigations, comments, and forks.

Two invariants shape everything:

1. **Append-only.** State like "contested" or "answered" is always *derived* from the record,
   never stored and mutated.
2. **Late-binding trust.** Writes are accepted with receipts; filtering/weighting happens at
   query time. No write-time gatekeeping.

## 2. Monorepo

```
epistemic-stack/
├── packages/db          @epistack/db — Drizzle schema + migrations (the commons)
│   ├── src/schema.ts    single source of truth for all tables
│   ├── src/index.ts     createDb(): globalThis-cached postgres.js pool (max 6)
│   └── drizzle/         generated migrations 0000…000N + meta/
├── packages/web         @epistack/web — Next.js 16 app (React 19, Tailwind v4)
│   ├── agent/           the eve agent (mounted into the app by withEve(), no separate server)
│   ├── app/             routes, server actions, UI components
│   ├── lib/             server + shared client logic
│   └── hooks/           realtime React hooks
└── supabase/            local stack config (Postgres :54422, API :54421, Studio :54423)
```

Bun workspaces; bun runs everything. Node ≥ 24 required (eve). Lint: biome at root,
**ultracite** preset inside `packages/web`.

## 3. Data layer (`packages/db/src/schema.ts`)

Everything lives in one Postgres (local Supabase). Drizzle ORM, snake_case columns.

**The commons (append-only):**

| Table | Purpose |
| --- | --- |
| `contributors` | People and agents (`kind: human \| agent`). eve is a fixed pseudo-contributor. |
| `contributions` | **The receipt spine.** One row per write: contributor, `session_id` (investigation), `turn_id` (chat turn that caused it), method (e.g. `record_claim@1`, `promote_comment@1`), payload hash, optional signature. Every domain row FKs a contribution. |
| `claims` | Canonical claim text + descriptors (modality, position, discipline…). Embedding column for dedup. |
| `sources` | Documents/URLs with guarantees (peer-reviewed…) and `retrieval` jsonb (how it was fetched; delegated runs stamp `{operator, delegationId, delegatorId, query}`). |
| `mentions` | Claim ↔ source links with the verbatim supporting quote (per-quote extraction receipts). |
| `relations` | Claim → claim edges: supports / contradicts / depends_on / refines. |
| `cruxes` | Decision-relevant open questions attached to claims. |
| `hypotheses`, `hypothesis_links` | Candidate answers + claim→hypothesis support/undermine edges. |
| `assessments` | **Polymorphic append-only judgments.** `kind='credence'`: belief 0–1 with timestamp (belief timeline). `kind='challenge'`: typed dispute (`challenge_type`: counter_evidence / rival_interpretation / methodological_objection) with optional `evidence_url`, threaded one level via `responds_to`. Targets claim/hypothesis/relation/source. |
| `lenses` | Saved trust perspectives: `config.rules` jsonb + `owner_id`. Saving one also writes a contribution receipt. |
| `questions` | Root questions investigations pursue. |

**App-side (not commons, still append-oriented):**

| Table | Purpose |
| --- | --- |
| `investigations` | One per eve session/room: id = eve session id, owner, title, `forked_from` self-FK, continuation token. |
| `investigation_turns` | (sessionId, turnId) → contributor: per-turn authorship. Joined with `contributions.turn_id` this yields "recorded by eve · during a turn asked by chris". |
| `comments` | Chat-anchored threads: quote + prefix/suffix re-anchoring, `visibility public\|private`, one-shot model-context flags (`context_queued`, `context_consumed_turn`). |
| `delegations` | Delegated eve investigations: delegator, brief, plan, step log, status, heartbeat, output contribution ids. |

**Migration workflow:** edit `schema.ts` → `bun run db:generate` → `bun run db:migrate`.
Additive/nullable columns only; never renumber or edit applied migrations. Migration `0004`
adds `contributions` to the `supabase_realtime` publication (live graph reload depends on it).

**Connection discipline:** always `createDb()` from `@epistack/db` — a globalThis-cached
singleton (pool max 6, idle_timeout 30). Ad-hoc `postgres()` clients + dev hot-reload
previously exhausted the 100-connection local Postgres.

## 4. eve integration

- `next.config.ts` wraps the app with `withEve()` — the agent in `agent/` and the Next app are
  **one process**; eve's HTTP surface is `/eve/v1/*` on the same origin.
- `agent/agent.ts` + `agent/instructions.md` define eve; `agent/tools/` are her commons tools
  (`record_claim`, `record_source`, `record_relation`, `record_crux`, `record_hypothesis`,
  `link_claim_to_hypothesis`, `query_commons`, `search_sources`, `search_web` (Tavily)).
  All tools funnel through `agent/lib/commons.ts`: embedding-based claim dedup + receipt
  writing, and each passes the current `turn_id` for provenance.
- Durable sessions: `@workflow/world-postgres` persists every session event
  (`WORKFLOW_POSTGRES_URL`). Key properties the multiplayer layer is built on:
  - `GET /eve/v1/session/:id/stream?startIndex=N` is a **replayable log** — any number of
    readers can attach at any index, streams stay open across turns.
  - The `continuationToken` is minted once at session creation and never rotates → any room
    member holding it can send. One active continuation at a time (concurrent sends race;
    the composer soft-locks during foreign turns).
- Helper model calls outside eve sessions (tours, delegation planning/synthesis, comment
  replies) use `lib/eve-model.ts` → Anthropic (`ANTHROPIC_API_KEY`) with OpenAI fallback.
- **Bundle warning:** `agent/lib/*` pulls `@huggingface/transformers`/onnxruntime. Next route
  handlers may import it (those packages are in Next's default `serverExternalPackages`), but
  regular server components/actions should not. Shared constants (eve contributor id) are
  duplicated on the web side on purpose (`lib/comments.ts`).

## 5. Multiplayer core

### 5.1 RoomStore — one stream, many clients (`lib/room/room-store.ts`)

Framework-free class; React binds via `useSyncExternalStore` in
`app/_components/room-provider.tsx`.

- **Every member — including the sender — ingests the durable session stream.** `send()`
  POSTs the message but never iterates the response; the follower loop
  (`session.stream({startIndex})`) is the single source of events. This is what makes any
  number of clients converge on identical transcripts.
- Two-log projection: authoritative events + a projection log with synthetic optimistic
  user messages (replaced on text-matched `message.received`).
- Turn lifecycle: `turn.started` → streaming (foreign turns lock the composer, author chips
  come from `investigation_turns` via `metadata.turnId`); boundary events → ready.
- `send()` assembles `clientContext` (how app context reaches eve without faking messages):
  `author`, `forkedFromContext` (fork seed), `pinnedComments` (one-shot queued comment
  threads), `commonsContext` (cross-investigation retrieval digest, §7.4).
- Stream nudging: `turn:pending` broadcast wakes parked follower loops instantly.

### 5.2 Rooms are URLs (`app/_components/app-shell.tsx`)

`/i/<sessionId>` is the room; `?fork=<id>` starts a fork. First send creates the eve session,
persists `{sessionId, continuationToken}`, and `history.replaceState`s the URL — a `liveId`
guard prevents remount. Room boot data comes from `GET /api/room/[id]` (route handler, not a
server action — server actions must never run during render) with an SSR suspend guard.

### 5.3 Identity — deliberately split (`lib/realtime/types.ts`)

- **Connections (`clientId`)**: per-tab, sessionStorage-persisted. Keys presence entries,
  cursors, cursor chat, tour hosting. Two tabs = two cursors, correctly.
- **People (`userId`)**: drives avatars (`dedupeByUser` — freshest connection wins), colors
  (`colorForUser`: FNV-1a hash → 8 fixed oklch hues; same color for a person's cursor,
  avatar, comment highlights everywhere), and attribution.

### 5.4 Channels (Supabase Realtime)

- Per-room `room:<id>` (`hooks/use-room-channel.ts`): presence (key = clientId, meta includes
  activity + which pane you're viewing) + broadcasts. Event catalog in
  `lib/realtime/types.ts` → `ROOM_EVENTS`: `cursor`, `cursor-chat`, `tour-start/step/end`,
  `delegation-start/step/end`, `turn:pending`, `turn:author`, `comments:changed`,
  `challenges:changed`.
- App-wide `lobby` (`hooks/use-lobby-presence.ts`): which room each connection is in — powers
  per-room avatar stacks in the sidebar.
- **Gotcha:** Supabase presence re-`track()` *appends* to a key's metas array — always read
  `metas.at(-1)`.
- Live graph reload rides `postgres_changes` on `contributions` (debounced refetch in
  `graph-panel.tsx`), so any commons write repaints every client — no bespoke events needed.

### 5.5 Cursors (`app/_components/presence/cursor-layer.tsx`)

Screen-space overlay inside `<ReactFlow>`. React renders only the peer list; a single rAF
loop reads the flow transform and writes `translate3d` directly (zero re-renders at pointer
speed), with frame-rate-independent damping. Cursors broadcast **flow coordinates** — which
only works because graph layout is deterministic (§6). Cursors *park* when idle (no fade);
they hide only on leave/gone. `/` opens Figma-style cursor chat; `@eve …` in it triggers
tours/answers; `@eve investigate …` triggers delegations.

## 6. The graph

- **Payload** (`lib/graph-data.ts` → `GET /api/graph[?investigation=]`): nodes (claims,
  sources, cruxes, hypotheses), edges, per-node `provenance` (contributor/method/createdAt —
  the read-time trust receipt), `counts` (including `credences` + `challenges`, which ride the client's
  reload signature so belief-only or dispute-only changes still repaint), per-node `t`
  timestamps (replay slider), challenge rollups, credence summaries. Scope = the
  investigation's **fork-ancestor chain**; challenges and credences are commons-wide on
  purpose.
- **Deterministic layout** (`graph-panel.tsx layout()`): inputs sorted by id, then d3-force
  (seeded LCG) — every client computes identical positions, which is the foundation for
  cursor/tour coordinate broadcasting. **Do not introduce randomness or unsorted input.**
- `graph-bus.ts`: module-singleton event bus; chat cards call `graphBus.emit("focusNode")` to
  open/center the graph.
- Inspector (`graph/inspector.tsx`): node detail + **Receipts** (provenance chain, "recorded
  by eve · during a turn asked by ‹user›", per-mention quotes) + **Disputes** (challenge
  threads, §7.2) + **Credence** (§7.5).

## 7. Feature subsystems

### 7.1 @eve tours & answers (`presence/use-tour.ts`, `app/api/tour/route.ts`)

`@eve <question>` from cursor chat → `/api/tour` → the model **decides** `answer` (eve cursor
pops up at the asker with a bubble) vs `tour` (asker's client becomes host: walks a per-tour
eve cursor node-to-node, broadcasting steps; followers' cameras glide along). Multiple
concurrent tours; hallucinated node ids dropped server-side; rolling per-tab eve memory feeds
context continuity.

### 7.2 Challenges & receipts (`lib/challenges.ts`, `app/_components/challenges/`)

Challenges are `assessments` rows (`kind='challenge'`) — so every dispute is itself a
receipted record in the commons. Typed (counter_evidence / rival_interpretation /
methodological_objection), optional evidence URL, one-level threaded responses. State is
derived: undisputed → contested (open challenge by a non-author) → answered. Surfaces: corner
flags on graph nodes, dispute chips on chat claim cards (batched count fetch), Disputes
section in the inspector, and **promote-a-comment-to-challenge** (cmdk node picker; method
`promote_comment@1`). `challenges:changed` broadcast + signature counts keep all clients live.

### 7.3 Lenses — late-binding trust (removed from the app 2026-07-06)

The lens UI (rules evaluator, aperture toolbar pill, node fading, diff mode, lens presence
+ adoption) was removed in a de-bloat pass. Late-binding trust remains a data-model concept —
the `lenses` table and per-node provenance receipts still exist — it just has no in-app UI.
The full implementation lives in git history (`feat/lenses`, merged 2026-07-05) if it's ever
revived. The shared-views tray (`view-shared` event) was removed in the same pass.

### 7.4 Cross-investigation compounding (`lib/commons-search.ts`, `app/api/commons/`)

Postgres full-text search across claims/hypotheses/cruxes/sources in **all** investigations
(embeddings deliberately not used web-side — transformers stays out of the bundle). Surfaces:
⌘K "Search the commons" dialog (sidebar), a prior-work strip above the composer, and **eve
context seeding** — `RoomStore.send()` fetches what *other* investigations (fork lineage
excluded) established about the question and injects a ≤1500-char digest as
`clientContext.commonsContext`, so eve answers "another investigation already established…".

### 7.5 Belief timeline (`lib/credences.ts`, `graph/credence-section.tsx`, time slider)

Credences are `assessments` (`kind='credence'`, append-only, 0–1). Hypothesis nodes/inspector
show community average (mean of each assessor's latest) + an SVG sparkline history + a range
input to register yours. The graph toolbar's **↺ replay** slider scrubs `timeCap`, hiding
nodes/edges with `t > cap` — replaying how the commons was built.

### 7.6 Delegated eve investigations (`lib/delegate/`, `app/api/delegate/`, `app/_components/delegate/`)

`@eve investigate <brief>` (cursor chat) or the investigations dock (graph top-right) creates
a `delegations` row and runs a bounded pipeline — plan (model call over the node catalog) →
research (Tavily web search, no model call) → synthesize (model call + commons writes via
`agent/lib/commons.ts`, so real dedup + receipts, attributed to eve with delegator recorded).
The **delegator's client drives** stepwise POSTs (`/api/delegate/step`) — every request ≤ one
model call, so no route timeouts — and broadcasts `delegation-*` events; everyone sees a
fuchsia `eve · investigating` cursor crawl the examined nodes, with live narration in the
dock. Concurrency: N per room; cancel is delegator-only; a step-silence reaper marks
abandoned runs interrupted. **No-source-no-claim:** without a verbatim web quote, eve adds
structure only (relations, cruxes, hypothesis links). Requires `TAVILY_API_KEY` for sourced
claims.

### 7.7 Comments (`app/_components/comments/`, `lib/comments.ts`)

Highlight text in any chat message → public comment or private note (server-filtered).
Anchoring: `{messageId, quote, prefix/suffix}` re-found via text-node walking; painting via
the CSS Custom Highlight API (no DOM mutation — colors = the author's identity hue); badges +
radix Popover threads. `@eve` in a reply pulls a model answer into the thread. **One-shot
context:** checkmark queues a thread to ride the *next* eve turn (`pinnedComments` digest),
then flips to a muted "was in context · re-queue" state, marked by consuming turn id.
Promotion to challenges: §7.2.

### 7.8 Forks

Fork button → `/?fork=<id>` → new investigation with `forked_from` set and a seed of the
source room's last answer in `clientContext`. Graph scope includes the full ancestor chain,
so forks inherit their lineage's evidence while diverging freely.

## 8. HTTP surface (`app/api/`)

| Route | Purpose |
| --- | --- |
| `GET /api/room/[id]` | Room boot snapshot (session, events, title, fork, authors) |
| `GET /api/graph[?investigation=]` | Graph payload (§6) |
| `POST /api/tour` | Answer-or-tour generation (§7.1) |
| `POST /api/delegate`, `/step`, `/cancel`; `GET ?investigation=` | Delegated investigations (§7.6) |
| `GET /api/commons/search?q=` | Cross-investigation full-text search (§7.4) |
| `POST /api/comments/eve` | @eve reply inside a comment thread |
| `/eve/v1/*` | eve's own surface (sessions, streams) — mounted by `withEve()` |

App routes are auth-gated via Supabase (`lib/supabase/server.ts`); the eve channel itself is
`auth: [none()]` — session ids/tokens are the capability, UI-layer auth is the gate.

## 9. Conventions & sharp edges

- **bun** everywhere; **no new dependencies without asking the repo owner** (standing rule).
- Node ≥ 24 (`.nvmrc`); eve refuses older.
- `bunx tsc --noEmit` + `bunx biome check .` must pass in **both** packages before a change
  is done. `packages/web` uses the stricter ultracite preset.
- Next 16: no server actions invoked during render; `params` is a Promise in route handlers;
  relative `fetch` fails during SSR (use the suspend-forever guard).
- Tailwind v4: `data-active:` variants match attribute *presence* — render
  `data-active={x || undefined}`.
- Deterministic graph layout is load-bearing (§6). Presence metas: read `.at(-1)` (§5.4).
- Realtime additions: extend `RoomEventPayloads` + `ROOM_EVENTS` in `lib/realtime/types.ts`;
  broadcast + local refetch on mutation, refetch on receive (the reload pattern).
- CSS: highlight names and cursor/tour animations live in `app/globals.css`; cursor pop
  animation must not touch opacity (the rAF loop owns it).
- `docs/plans/` holds the per-feature build plans, including punted follow-ups.
