# Investigation Journal — view the whole trail

"Is there a way to view an entire investigation? All the actions eve took and
the thinking?" — Yes. Everything is already persisted in `investigations.events`
(the durable eve session snapshot) and the `delegations` table. This is a reader.

## What's persisted (verified against the live local DB)

`investigations.events` is a jsonb array of durable session events. Each has
`{ type, data, meta: { at: ISO } }`. Relevant types:

- `turn.started` — `{ turnId, sequence }` — a new turn begins.
- `message.received` — `{ turnId, message }` — **the user's question** (author
  not in the event; `investigation_turns` would name them but is currently
  empty, so we fall back to "a researcher").
- `step.started` / `step.completed` — reasoning/tool steps; `step.completed`
  carries `usage` token counts.
- `message.appended` — streaming deltas (skipped; noise).
- `message.completed` — `{ message, finishReason }`. `finishReason:"tool-calls"`
  → eve's **pre-tool narration** ("thinking"). Any other finishReason → the
  **final answer** for the turn.
- `actions.requested` — `{ actions: [{ toolName, input, callId }] }` — eve's
  tool calls (query_commons, search_sources, search_web, record_source,
  record_claim, record_relation, record_crux, record_hypothesis,
  link_claim_to_hypothesis).
- `action.result` — `{ result: { callId, output } }` — the tool's return.
  record_* return `{ claim_id | source_id | …, is_new }`; search_* return
  result arrays; query_commons returns `{ matches }`.
- `turn.completed`, `session.waiting` — turn/idle boundaries.

`delegations` rows: `{ id, session_id, delegator_id, brief, status, summary,
steps: [{ at (epoch ms), kind, narration, nodeId? }], output: { claims,
sources, relations, cruxes, hypotheses, links }, created_at }`.

**Not separately persisted:** there is no distinct "reasoning" channel — the
"thinking" IS the tool-calls-finish assistant text between tool calls. That's
what we surface. Token usage per step is available and shown subtly.

## Build

- `lib/journal.ts` (server-only): `buildJournal(sessionId)` →
  `{ title, turns: JournalTurn[], delegations: JournalDelegation[] }`.
  Groups events by `turnId` in order; each turn = `{ turnId, at, question,
  thinking: string[], actions: JournalAction[], answer, tokens }`. Each
  `JournalAction` = `{ tool, at, summary, nodeId? }` where summary is a
  human line ("Recorded claim … · merged" / "Searched the web · 5 results")
  and nodeId maps record_claim→claim_id, record_source→source_id,
  record_crux→`crux:<id>`, record_hypothesis→`hyp:<id>` for focus.
- `app/api/journal/[id]/route.ts`: auth-gated GET, returns buildJournal(id).
  This room only (no fork ancestors — extension path noted).
- `app/_components/journal/journal-panel.tsx`: right slide-over (`panel-in-right`,
  w-[26rem]), chronological turns + delegations interleaved by timestamp.
  Per turn: question header (timeAgo), collapsible "eve's reasoning", action
  lines (record lines clickable → graphBus focusNode), answer (collapsible).
  eve rows get the violet SparklesIcon. "Load earlier" pagination (recent 12
  turns first). Opened from a Journal button in the graph toolbar.

## Scope
Read-only. No schema changes, no new events, no new deps. Fork-ancestor
investigations excluded (extension: union getAncestorChain sessions).
