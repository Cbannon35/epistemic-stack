# Cross-investigation compounding + belief timeline

Prove the commons compounds: work from one investigation benefits every other, and
community belief is trackable over time. Branch: `feat/compounding-timeline`.

## Retrieval: Postgres full-text search (not vectors)

Only `claims` carry embeddings; hypotheses/cruxes/sources don't. Embedding a query
requires the gte-small ONNX model, and the codebase deliberately keeps
`@huggingface/transformers` out of the Next bundle (see lib/comments.ts — the agent
host loads it, the web server never does). So: `websearch_to_tsquery`/OR-relaxed
`plainto_tsquery` + `ts_rank` over claims.text, hypotheses.statement, cruxes.question,
sources.title/author/publisher. No index at demo scale; upgrade path = GIN expression
indexes, then hybrid vector rerank for claims.

- `lib/commons-search.ts` — server-only FTS across the four kinds, LEFT JOIN
  contributions → investigations/contributors for origin attribution; `and` mode for
  the search UI (short keyword queries), `or` mode for question-shaped eve seeding.
- `GET /api/commons/search` — auth-gated route for the UI.

## Surfaces

1. **Search the commons** (⌘K) — cmdk CommandDialog (wrapper already exists), opened
   from a sidebar header button. Result rows show kind + origin investigation +
   contributor; click → focus node in the graph if it's the open investigation,
   otherwise navigate to `/i/<origin>`.
2. **Eve context seeding** — `getCommonsSendContext` server action; RoomStore.send()
   kicks it off in parallel and, when non-empty, injects a ≤1500-char digest as
   `clientContext.commonsContext` (same one-turn mechanism as pinnedComments /
   forkedFromContext; eve forwards clientContext to the model, no agent changes).
   Excludes the room's own fork-ancestor chain — that's already in scope.
3. **Prior work strip** — after the first answer lands in a room, fetch top hits for
   the room's question from OTHER investigations; render a dismissible strip above
   the composer.

## Belief timeline: reuse `assessments`, no new table

The schema already has an append-only `assessments` table (kind `credence`,
hypothesis target, 0..1 credence, contribution receipt) — it exists precisely so
credence is late-binding. A parallel `credences` table would fork that design, and
the lens layer reads assessments. So: **no schema change at all**.

- `lib/credences.ts` — insert contribution (`record_credence@1`) + assessment;
  list history (join contributors + contributions.createdAt).
- Community credence = mean of each assessor's LATEST value; full history feeds a
  hand-rolled SVG sparkline.
- Hypothesis nodes show the community % + n; the Inspector gets a credence section:
  sparkline, per-assessor chips, and a 0–100 range input to register yours.
- Writes insert a contribution row → the existing `postgres_changes` INSERT
  subscription on `contributions` already reloads the graph on every client. The
  graph reload signature gains a `credences` count so detail-only changes repaint.

## Replay slider

`buildGraphData` attaches `t` (contribution createdAt, epoch ms) to every node and
edge. GraphPanel gets a `timeCap` state + a "replay" pill; `time-slider.tsx` renders
a bottom bar (range input over [minT,maxT] + play). Filtering is client-side; layout
is computed from the FULL graph so nodes hold position and pop in place as time runs.

## Shared-file edits (kept additive; everything else is new files)

lib/graph-data.ts, app/_components/graph/{types.ts,nodes.tsx,inspector.tsx,
assessment-panel.tsx,graph-panel.tsx}, lib/room/room-store.ts (two insertions in
send()), agent-chat.tsx (mount strip), app-sidebar.tsx (search button).
