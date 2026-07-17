# Merge requests, releases, and agent multiplayer — design

Date: 2026-07-17. Brainstormed autonomously overnight (user asleep); every decision
below records its rationale and the alternatives considered, per the user's
instruction to "document what design decisions/tradeoffs you made and why."

## Vision context

The product direction is "git + GitHub + ChatGPT + skills.sh for creating and vending
knowledge graphs." Forks exist and are excellent; this spec adds the three highest-leverage
missing pieces:

1. **Merge requests** — the path back from a fork, with a graph-diff review UX.
2. **Named releases** — citable, versioned checkpoints of an investigation's graph.
3. **Agent multiplayer** — write-capable MCP so external agents join rooms (or create
   their own) through the same receipt-and-scope flow the UI uses, visible live to
   everyone in the room.

## Shared foundation

### Scope hops (the one abstraction all three features ride)

`buildGraphData` already reduces an investigation's visible graph to a
`Map<sessionId, cutoff | null>` built from the fork-ancestor chain. All three features
are expressible as manipulations of that map:

- **Merge** = adding the source fork's `(sessionId, cutoff)` entries to the target's map.
- **Release** = min-composing a global `asOf` timestamp over every entry (and bounding
  the unbounded leaf).
- **Agent writes** = ordinary contributions whose `sessionId` is the room they joined,
  so they flow into scope with zero new read-path code.

We extract the chain→scope logic into `getScopeHops(investigationId)` in
`lib/investigations.ts` returning `ScopeHop[] = { sessionIds: string[], cutoff: number | null }[]`,
and extend `buildGraphData(investigation, opts?)` with:

- `opts.asOf?: number` — epoch-ms cap composed into every hop (releases; also caps
  commons-wide challenge/credence data so a citation is faithful to its moment).
- `opts.extraHops?: ScopeHop[]` — additional hops (merge preview).
- `opts.hopsOverride?: ScopeHop[]` — replace hops entirely (release pages render from
  materialized hops so they survive fork deletion).

### Server-side room broadcast

Today all room events are client-broadcast. Merge decisions (which must notify a
*different* room than the actor's) and MCP agents (which have no browser) both need the
server to emit room events. New helper `lib/realtime/server-broadcast.ts`: POSTs to
Supabase Realtime's broadcast REST endpoint (`{SUPABASE_URL}/realtime/v1/api/broadcast`)
with the service key. No new dependency; it is a plain `fetch`. Fire-and-forget with a
short timeout — realtime nudges are best-effort by existing convention (clients also
refetch on their own signals).

**Tradeoff:** the alternative (client subscribes to the second room's channel just to
send) adds websocket churn and can't serve agents at all. REST broadcast serves both.

## Feature 1 — Merge requests + graph diff

### Semantics

A merge is **scope adoption, not content copying**. The fork's contributions already
live in the commons; accepting a merge makes the target's lineage *see* them. This is
the append-only answer to "pull request": nothing moves, nothing merges textually —
the target's view widens. The fork room, its transcript, and its future all remain its
own (merging does not close the fork, mirroring GitHub where a merged branch may live on).

### Data model (`merge_requests`, app-side operational table)

- `id` uuid PK
- `sourceId` text — the fork (NO foreign key: an accepted merge must survive the source
  fork's later deletion; commons contributions survive fork deletion already, so the
  materialized hops below keep resolving)
- `targetId` text — the receiving investigation (no FK, same reason; cleanup below)
- `proposerId` uuid FK → contributors
- `note` text — the proposer's rationale (the PR description)
- `status` text: `open | accepted | declined | withdrawn`
- `reviewerId` uuid nullable, `decidedAt` timestamptz nullable, `decisionNote` text nullable
- `mergedHops` jsonb nullable — **materialized at accept time**: the source's scope hops
  not already present in the target's chain, each cutoff min-composed with the accept
  moment. Materializing (vs. resolving the source's lineage at read time) freezes the
  merge's meaning at the moment of review — what the reviewer approved is what the
  target gets, regardless of what later merges into the source or whether the source is
  deleted. This mirrors how the fork feature already stores `forkCutoff` rather than
  recomputing it.
- `contributionId` uuid nullable — receipt written at accept (`method: merge@1`,
  `sessionId: targetId`). Because migration 0004 put `contributions` in the realtime
  publication, this insert **automatically repaints every client's graph** — the merged
  nodes appear live with no bespoke plumbing.
- `createdAt`, `updatedAt`

### Read-path change

`getScopeHops` walks the ancestor chain as today; for each investigation visited it
also loads accepted merges into it and appends their `mergedHops`, with each cutoff
min-composed against the walk bound at that hop. Rule: a merge accepted into ancestor A
*before* the chain forked away from A is part of A's history and flows down; one
accepted after is not. (Same time-composition rule forks already use.)

### Diff

`computeMergeDiff(sourceId, targetId)` in `lib/merge.ts`: build both graph payloads,
diff by node/edge id. Returns `incoming` (nodes + edges in source scope but not target
scope, with provenance), plus counts (`incoming`, `shared`, `targetOnly`). Since the
graph is append-only there is no "modified" state to render — additions are the diff.

### Permissions

- **Propose:** any signed-in member of the fork (append-only, harmless).
- **Accept/decline:** the target investigation's **owner** (`contributorId`) — the
  GitHub-maintainer analog. Considered "any room member" for symmetry with the
  collaborative ethos, but merge changes what *everyone* in the target lineage sees, and
  a review gate is the entire point of a PR flow. Owner-only, documented in UI copy.
- **Withdraw:** the proposer.
- `deleteFork` additionally: withdraws that fork's open MRs (status flip), deletes MRs
  *targeting* the fork (their room is gone), and — matching the existing "has forks"
  rule — keeps accepted outgoing merges working via materialized hops (no action needed).

### Surfaces

- **Fork room:** "propose merge" button in the graph toolbar (visible only when
  `forkedFrom` is set): dialog shows the live diff summary + note field.
- **Target room:** an MR chip in the graph toolbar with an open-count badge → panel
  listing open MRs (proposer, note, diff counts). Selecting one opens review mode:
  - Incoming nodes/edges listed by kind with labels + provenance receipts.
  - **Preview in graph:** the graph refetches `/api/graph?investigation=<target>&mergePreview=<mrId>`
    (target scope + source hops) and paints incoming nodes with a distinct "incoming"
    treatment. Known tradeoff, documented: while previewing, the previewing client's
    layout diverges from other clients (deterministic layout is per-payload), so remote
    cursors/tours point slightly wrong *for the previewer only, while the panel is open*.
    Accepted: preview is a transient, single-user review mode.
  - Accept / decline (+ optional decision note) for the owner; others see read-only.
- **Realtime:** new room event `merge:changed` broadcast server-side to BOTH rooms'
  channels; clients refetch MR lists. Graph repaint rides the contributions insert.

### HTTP/actions

- Server actions: `openMergeRequestAction`, `decideMergeRequestAction`, `withdrawMergeRequestAction`.
- `GET /api/merge?investigation=<id>` — MRs where the id is source or target (room boot + refetch).
- `GET /api/merge/[id]/diff` — diff payload for review (also powers the propose dialog
  via a transient `source/target` query form: `GET /api/merge/diff?source=&target=`).

## Feature 2 — Named releases + citable versions

### Semantics

A release is a **named, immutable, publicly citable snapshot recipe**: investigation +
scope hops + an `asOf` moment. Nothing is copied or frozen in the DB (append-only
friendly) — immutability falls out of time-capping an append-only ledger: the same hops
+ the same `asOf` always resolve to the same graph.

### Data model (`releases`)

- `id` uuid PK — the public permalink key
- `investigationId` text (no FK — release pages must survive fork deletion)
- `titleSnapshot` text — investigation title at cut time (rooms can be renamed/deleted;
  a citation's title must not drift)
- `version` integer — per-investigation, `max+1` in a transaction; unique index on
  `(investigationId, version)`
- `name` text nullable (optional human label, e.g. "post-Rootclaim revision")
- `notes` text nullable (release notes)
- `cutoff` timestamptz — the `asOf` moment
- `hops` jsonb — materialized `ScopeHop[]` at cut time (includes accepted merges)
- `createdBy` uuid FK → contributors, `createdAt`
- `contributionId` uuid — receipt (`method: release@1`, `sessionId: investigationId`) →
  live repaint + a row in the room's receipt trail

### Permissions

Any signed-in contributor can cut a release. Considered owner-only (GitHub-maintainer
analog) but rejected: releases are pure additions (no scope change for anyone), the
`createdBy` receipt carries accountability, and late-binding trust is the project's
philosophy — restricting checkpoint-creation would be write-time gatekeeping.

### Surfaces

- **Room:** a "release" button in the graph toolbar → dialog listing existing versions
  (public link + copy-citation per row) and a cut form (name, notes) → success pane with
  public URL, plain-text citation, and BibTeX.
- **Public page `/releases/[id]`** (ISR, no auth — mirrors `/topics/[slug]`):
  title + `vN`, name/notes, cut date, creator, stat tiles, hypotheses with as-of
  credences, graph preview (reusing the topic page's preview component), contributor
  list, citation card (plain + BibTeX with copy buttons), JSON export link.
- **Export `GET /api/releases/[id]/export`** — the topic export shape plus
  `release: {version, cutoff, citation}`; provenance receipts included, no auth gate
  (same rationale as topic export).
- Citation format: `<creator(s)>. "<title>" (v<N>). Epistemic commons release, <date>. <url>`
  plus a BibTeX `@misc` with `note = {Version N, graph as of <cutoff ISO>}`.

Punted (documented for later): cross-release diff ("what changed between v1 and v2" —
`computeMergeDiff` generalizes trivially once wanted), release RSS, per-release MCP scope.

## Feature 3 — Write-capable MCP: agents as multiplayer participants

### Semantics

An external agent is a **first-class contributor**: it authenticates with a minted key,
joins any investigation (or creates its own), and writes through the *same* code path as
eve — embedding dedup, content addressing, contribution receipts, `sessionId` scoping.
Rooms see it live: an agent cursor glides to nodes it touches, an "agents online" chip
shows liveness, and the graph repaints via the existing contributions realtime feed.
"Same flow as the UI" is satisfied at the receipts layer — an agent write is
indistinguishable in the ledger from an eve write except for its contributor identity.

### Auth (`agent_keys`)

- `id` uuid PK, `tokenHash` text unique (sha256 of the bearer token; token itself never
  stored), `contributorId` uuid FK → contributors (kind=`agent`), `createdBy` uuid FK →
  contributors (the human who minted), `createdAt`, `lastUsedAt`, `revokedAt` nullable.
- Token format `esk_<48 hex>`, shown exactly once at mint.
- Mint/revoke UI: "Connect an agent" in the sidebar footer → dialog (agent name →
  contributor row + key; list of your agents with revoke). Server actions gated by
  Supabase auth, mirroring `topic-actions.ts`.
- Design note: bearer-token-as-capability matches the existing eve channel model
  (ARCHITECTURE §8: "session ids/tokens are the capability, UI-layer auth is the gate").
  Rate limiting is out of scope for the local/competition build; keys are minted by
  signed-in users and revocable.

### Endpoint

`/api/mcp/agent/[transport]/route.ts` — same per-request `createMcpHandler` pattern as
the per-topic servers. Reads `Authorization: Bearer esk_…`; 401 unless the hash resolves
to an unrevoked key. Registers the read tools (unscoped `registerCommonsTools`) plus:

- `list_investigations` / `create_investigation({title, seed_from_commons?})` →
  investigation row id `agent_<uuid>` owned by the agent contributor (appears in
  everyone's sidebar instantly — you can watch an agent's room build). Fork rows already
  prove rooms exist happily before any eve session binds (`eveSessionId` null); agent
  rooms are the same shape with an empty prelude.
- `get_investigation_graph({investigation_id})` — bounded summary (counts, hypotheses
  assessment, node id+label catalog capped like topic slices) so agents can orient.
- Write tools, each taking `investigation_id`: `record_source`, `record_claim`,
  `record_relation`, `record_hypothesis`, `link_claim_to_hypothesis`, `record_crux` —
  thin wrappers over `agent/lib/commons.ts` (route handlers may import it;
  transformers stays out of the general bundle), passing the agent's `contributorId`
  and `sessionId = investigation_id`, `retrieval.operator = "mcp-agent"`.
- `record_credence` and `file_challenge` — wrappers over the existing `lib/credences.ts`
  / `lib/challenges.ts` write functions (they already take a contributorId). Agents that
  can put beliefs on the record and file typed disputes are the epistemic point of the
  whole build; both are one-liners over existing functions.

`agent/lib/commons.ts` change: every write gains an optional `contributorId` defaulting
to the eve constant — additive; eve and delegation callers unchanged.

### Liveness (how the room *sees* the agent)

MCP over streamable HTTP is stateless per request, so a websocket presence entry is
impossible without a resident process. Instead:

- Every successful write tool fires `broadcastRoomEvent(investigationId, "agent-activity",
  {contributorId, name, action, nodeId?, ts})` (server-side broadcast helper).
- Clients keep an active-agents map (expire after ~75s of silence): renders as
  (a) an "agent online" chip beside the human avatar stack (bot mark + name + pulse), and
  (b) an **agent cursor** in the graph that glides to each touched node with a narration
  bubble — implemented on the same cursor-registry mechanics tours and delegations
  already use (namespace `agent:<contributorId>`).
- Graph repaint needs nothing: contributions insert → existing `postgres_changes` reload.

**Tradeoff documented:** the agent won't appear in the *presence* stack proper (that's
websocket state); the activity-derived chip is honest about what it knows ("active 20s
ago") and degrades gracefully when an agent goes quiet. Journal narration of MCP-agent
actions is punted (journal reads eve session events; agent actions surface via graph
receipts + cursor + ticker instead).

## Schema summary (all additive)

Three new tables: `merge_requests`, `releases`, `agent_keys`. No column changes to
existing tables. One migration via `bun run db:generate`.

## New realtime events

`merge:changed`, `agent-activity` — added to `RoomEventPayloads` + `ROOM_EVENTS`
(`lib/realtime/types.ts`), following the "broadcast + refetch" convention.

## Docs

`docs/ARCHITECTURE.md` gains §7 subsections for merges, releases, and agent MCP, plus
HTTP-surface table rows and schema-table rows — and (drift found during the sweep) a
short subsection documenting the existing topics/MCP vending surface, which shipped
undocumented. CLAUDE.md feature map gains the three new rows.

## Testing / verification

- `bunx tsc --noEmit` + `bunx biome check .` in both packages (the repo's definition of done).
- Live verification against the local stack: seed two investigations + a fork via SQL/HTTP,
  exercise propose→diff→accept and confirm the target scope widens; cut a release and
  fetch its public page + export; mint an agent key and drive the MCP endpoint with
  curl (initialize, create_investigation, record_hypothesis/claim), confirming receipts,
  scope, and broadcasts.
