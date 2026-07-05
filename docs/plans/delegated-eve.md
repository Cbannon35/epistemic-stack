# Delegated eve investigators

Room members can assign eve a bounded sub-investigation ("@eve investigate …" in
cursor chat, or the composer in the investigations dock). A background run
plans, examines relevant graph nodes, optionally searches the web (Tavily, when
`TAVILY_API_KEY` is set), and finishes by writing receipted contributions to the
commons — the whole room watches a delegated eve cursor crawl the graph while
it works.

## Orchestration shape: client-driven stepwise POST loop

Same pattern as tours, hardened: the delegating client drives a short POST per
phase and broadcasts progress over the room channel. Chosen over one long
streaming request because each request stays under one model call (no route
timeouts), aborts are trivial (stop looping), and every phase persists to a
`delegations` row so late joiners see history.

Phases (server, `lib/delegate/run.ts`):

1. **start** — auth, insert row, model call #1 (`generateObject`): plan of
   attack + 2–4 existing nodes worth examining (with notes) + up to 2 search
   queries. Grounded in the same node catalog as `/api/tour`.
2. **research** — Tavily fetch for the plan's queries (no model call). Without
   `TAVILY_API_KEY` the phase records that eve is working from the existing
   record only.
3. **synthesize** — model call #2: turn findings + graph into contributions —
   sourced claims (only when web findings exist: no source, no claim),
   relations / hypothesis links / cruxes over existing or just-recorded claims,
   at most one new hypothesis, plus a summary. Writes go through
   `agent/lib/commons.ts` (embedding dedup, receipts). Contribution inserts
   fire the existing `postgres_changes` graph reload on every client.

`@huggingface/transformers` + `onnxruntime-node` are in Next's default
`serverExternalPackages`, so importing `agent/lib/commons.ts` from a route
handler is safe (verified in `server-external-packages.jsonc`).

## Provenance

- Contributions are attributed to the existing eve agent contributor
  (`…0a1`), with `sessionId` = the room.
- The `delegations` row records delegator, brief, plan, step log, summary, and
  the ids of everything written (`output` jsonb).
- Each web source's `retrieval` jsonb carries
  `{operator: "delegated_investigation@1", delegationId, delegatorId, query}`.

## Multiplayer surface

- New broadcasts `delegation-start/-step/-end` (additive in
  `lib/realtime/types.ts`); cursor ids namespaced `eve:dg:<id>` so they ride
  the existing eve-cursor registry (tau 250 glide) but render in a distinct
  color with the label "eve · investigating".
- Host client plays each phase's narrations with reading-time dwell, ringing
  examined nodes (`delegate-ring`), then POSTs the next phase.
- Followers resolve nodeIds locally (deterministic layout), fallback x/y.
- Concurrency: a `Map<delegationId, run>` per client; different members (and
  the same member) can run several at once.
- Aborts: dock cancel → POST cancel + `delegation-end`; vanished host → 60s
  step-silence reaper hides the cursor; stale `running` rows are reported as
  `interrupted` by the list endpoint.
- **Investigations dock** (`delegation-dock.tsx`, top-right of the graph):
  running/completed delegations with live step narration, summary, cancel for
  your own, and a composer to delegate without cursor chat. Seeded by
  `GET /api/delegate?investigation=…`, updated by broadcasts.
- Completion: the cursor speaks the summary, the dock keeps it permanently.
  (Not injected into the chat transcript — that would fabricate a model turn.)

## Files

New: `lib/delegate/{types,run,search}.ts`,
`app/api/delegate/{route,step/route,cancel/route}.ts`,
`app/_components/delegate/{use-delegations.ts,delegation-dock.tsx}`.

Shared-file edits (additive): `packages/db/src/schema.ts` (append
`delegations` table — migration generated at integration),
`lib/realtime/types.ts` (event types + ROOM_EVENTS + cursor-id helpers),
`app/_components/presence/cursor-layer.tsx` (mount hook, intercept
`@eve investigate`, render cursors + dock),
`app/_components/presence/cursor.tsx` (respect the `color` prop for eve
cursors), `app/globals.css` (append `delegate-ring` styles).
