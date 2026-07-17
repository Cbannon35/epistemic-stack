# Merge Requests + Releases + Agent Multiplayer MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship fork merge-requests with a graph-diff review UX, named/citable releases, and a write-capable MCP endpoint that makes external agents live multiplayer participants.

**Architecture:** All three features ride the existing scope-hop math in `buildGraphData` (merge = extra hops; release = time-capped hops; agent writes = ordinary receipted contributions keyed to a room's sessionId). One new primitive — server-side room broadcast over Supabase Realtime's REST endpoint — serves both cross-room merge notifications and agent liveness.

**Tech Stack:** Next.js 16 / React 19, Drizzle + local Supabase Postgres, mcp-handler + @modelcontextprotocol/sdk (already installed), Tailwind v4, radix-ui. **No new dependencies.**

## Global Constraints

- **No new packages** (standing repo rule; user asleep, cannot approve).
- Schema changes additive only; generate via `bun run db:generate`, never hand-edit applied migrations.
- Verification per task: `cd packages/web && bunx tsc --noEmit && bunx biome check .` (plus `packages/db` when schema changes). There is NO test framework in this repo — the repo's definition of done is typecheck + ultracite lint + live-flow verification (final task).
- `agent/lib/*` may be imported ONLY from route handlers (`app/api/**/route.ts`).
- Never call server actions during render; render-time data via route handlers + fetch.
- Realtime additions extend `RoomEventPayloads` + `ROOM_EVENTS` in `lib/realtime/types.ts`.
- Tailwind v4: `data-active={x || undefined}`, never `false`.
- `createDb()` singleton only; no raw postgres clients.
- Graph layout determinism: never feed unsorted/random input to `layout()`.
- Commit after every task with a descriptive message.

---

### Task 1: Schema — `merge_requests`, `releases`, `agent_keys`

**Files:**
- Modify: `packages/db/src/schema.ts` (append after `topics`)
- Generate: `packages/db/drizzle/00NN_*.sql` via `bun run db:generate`

**Interfaces (produces):** `schema.mergeRequests`, `schema.releases`, `schema.agentKeys`.

- [ ] **Step 1: Append the three tables to `schema.ts`:**

```ts
// ── merge requests ───────────────────────────────────────────────────────────
// A fork proposing itself back into its parent's visible scope. Merging is
// SCOPE ADOPTION, not content copying: the fork's contributions already live
// in the commons; acceptance widens the target lineage's read scope. The row
// is app-side operational state (like delegations); the commons receipt is
// the `merge@1` contribution written at accept time.
export const mergeRequests = pgTable(
  'merge_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No FKs on source/target: an ACCEPTED merge must survive the source
    // fork's later deletion (its commons writes survive; mergedHops below
    // keeps them resolvable). deleteFork() tidies open rows explicitly.
    sourceId: text('source_id').notNull(),
    targetId: text('target_id').notNull(),
    proposerId: uuid('proposer_id')
      .notNull()
      .references(() => contributors.id),
    note: text('note'),
    status: text('status').notNull().default('open'), // open|accepted|declined|withdrawn
    reviewerId: uuid('reviewer_id').references(() => contributors.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    // Materialized at accept: [{sessionIds: string[], cutoff: number|null}] —
    // the source hops absent from the target's chain, cutoffs min-composed
    // with the accept moment. Frozen so what the reviewer approved is what
    // the target gets, forever (mirrors forkCutoff).
    mergedHops: jsonb('merged_hops'),
    contributionId: uuid('contribution_id').references(() => contributions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merge_requests_target_idx').on(t.targetId),
    index('merge_requests_source_idx').on(t.sourceId),
  ],
)

// ── releases ─────────────────────────────────────────────────────────────────
// A named, citable checkpoint: investigation + materialized scope hops + an
// asOf moment. Nothing is copied — immutability falls out of time-capping an
// append-only ledger. Public page /releases/<id>; survives room deletion via
// the materialized recipe (titleSnapshot + hops).
export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    investigationId: text('investigation_id').notNull(), // no FK, see above
    titleSnapshot: text('title_snapshot').notNull(),
    version: integer('version').notNull(),
    name: text('name'),
    notes: text('notes'),
    cutoff: timestamp('cutoff', { withTimezone: true }).notNull(),
    hops: jsonb('hops').notNull(), // ScopeHop[] at cut time (merges included)
    createdBy: uuid('created_by')
      .notNull()
      .references(() => contributors.id),
    contributionId: uuid('contribution_id')
      .notNull()
      .references(() => contributions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('releases_inv_version_idx').on(t.investigationId, t.version),
    index('releases_inv_idx').on(t.investigationId),
  ],
)

// ── agent keys ───────────────────────────────────────────────────────────────
// Bearer capability for the write-capable agent MCP endpoint. The token is
// never stored — only its sha256. Minted by a signed-in human for an agent
// contributor; revocation is a timestamp (the key row itself is the record).
export const agentKeys = pgTable(
  'agent_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => contributors.id),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agent_keys_token_idx').on(t.tokenHash)],
)
```

- [ ] **Step 2:** `bun run db:generate` (repo root) → new numbered migration; then `bun run db:migrate` against the running local stack. Expected: "applied" with the three CREATE TABLEs.
- [ ] **Step 3:** `cd packages/db && bunx tsc --noEmit && bunx biome check .` → clean.
- [ ] **Step 4:** Commit `feat(db): merge_requests, releases, agent_keys tables`.

### Task 2: Server-side room broadcast + new realtime events

**Files:**
- Create: `packages/web/lib/realtime/server-broadcast.ts`
- Modify: `packages/web/lib/realtime/types.ts` (add `merge:changed`, `agent-activity` to payloads + `ROOM_EVENTS`; add `AGENT_CURSOR_PREFIX`)

**Interfaces (produces):**
- `broadcastRoomEvent(roomId: string, event: RoomEventName, payload: unknown): Promise<void>` (server-only, best-effort, never throws)
- `MergeChangedEvent = { mrId: string; sourceId: string; targetId: string; action: "opened"|"accepted"|"declined"|"withdrawn"; actorName?: string }`
- `AgentActivityEvent = { contributorId: string; name: string; action: string; nodeId?: string | null; investigationId: string; ts: number }`
- `agentCursorId(contributorId)` with prefix `"agent:"`

- [ ] **Step 1:** `server-broadcast.ts`:

```ts
import "server-only";
import { roomTopic } from "@/lib/realtime/types";

// Server-side broadcast onto a room channel via Supabase Realtime's REST
// endpoint — for emitters with no browser websocket: merge decisions (which
// must notify the OTHER room) and MCP agents. Best-effort by convention:
// clients that miss a nudge still converge via refetch-on-signal paths.
export async function broadcastRoomEvent(
  roomId: string,
  event: string,
  payload: unknown
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!(url && key)) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ topic: roomTopic(roomId), event, payload, private: false }],
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // best-effort — a lost nudge only delays a refetch
  }
}
```

- [ ] **Step 2:** Extend `types.ts` with the two event types above, add to `RoomEventPayloads` and `ROOM_EVENTS`, and add `AGENT_CURSOR_PREFIX = "agent:"` + `agentCursorId()` beside the eve/delegate cursor helpers.
- [ ] **Step 3:** typecheck + lint web; commit `feat(realtime): server-side room broadcast + merge/agent events`.
- [ ] **Step 4 (live check, dev stack running):** `curl -s -XPOST localhost:54421/realtime/v1/api/broadcast -H "apikey: <service>" -H "authorization: Bearer <service>" -H 'content-type: application/json' -d '{"messages":[{"topic":"room:test","event":"agent-activity","payload":{}}]}'` → 202. (If the local realtime image rejects the endpoint, fall back: broadcast via a short-lived `@supabase/supabase-js` server client channel subscribe+send — still no new dep. Decide by the curl result.)

### Task 3: Scope hops — `getScopeHops` + `buildGraphData` options

**Files:**
- Modify: `packages/web/lib/investigations.ts` (add `ScopeHop`, `getScopeHops`)
- Modify: `packages/web/lib/graph-data.ts:86-101` (options param; scope from hops)
- Modify: `packages/web/app/api/graph/route.ts` (accept `mergePreview` + `asOf` params)
- Modify: `packages/web/lib/credences.ts` + `lib/challenges.ts` (optional `asOf` filters)

**Interfaces (produces):**
```ts
export type ScopeHop = { sessionIds: string[]; cutoff: number | null };
export async function getScopeHops(id: string): Promise<ScopeHop[]>;
export type GraphOptions = { asOf?: number | null; extraHops?: ScopeHop[]; hopsOverride?: ScopeHop[] };
export async function buildGraphData(investigation: string | null, opts?: GraphOptions): Promise<GraphPayload>;
```

- [ ] **Step 1:** `getScopeHops(id)`: run `getAncestorChain(id)`; for each chain hop, `SELECT` accepted `merge_requests` where `targetId = hop.id`; include a merge's `mergedHops` iff `decidedAt <= (hop.cutoff ?? ∞)` (a merge accepted after the chain forked away from that ancestor is not this fork's history); min-compose each merged hop's cutoff with the walk bound. Return `[{sessionIds: hopSessionIds(hop), cutoff: hop.cutoff}, ...mergedHopsBounded]`.
- [ ] **Step 2:** `buildGraphData`: replace the inline chain→scope block with hops (`opts.hopsOverride ?? [...(await getScopeHops(id)), ...(opts.extraHops ?? [])]`); apply `asOf` by min-composing into every cutoff AND capping unbounded hops; when `investigation == null && asOf` set, cap the unscoped view by timestamp too. Thread `asOf` into `listCredences` (filter `createdAt <= asOf`) and `challengeSummaryByNode`/`getNodeReceipts` summary (filter assessments by `createdAt <= asOf`) so releases cite faithfully.
- [ ] **Step 3:** `/api/graph`: parse `mergePreview` (mr id → load open MR → `extraHops = liveSourceHops minus target's` via the merge lib from Task 4 — wire the param now, return 400 until Task 4 lands if needed; simplest: implement param in Task 4 and only `asOf` here).
- [ ] **Step 4:** typecheck + lint; commit `refactor(graph): scope hops with merge + asOf composition`.

### Task 4: Merge library + actions + API + deleteFork cleanup

**Files:**
- Create: `packages/web/lib/merge.ts`
- Create: `packages/web/app/(chat)/merge-actions.ts`
- Create: `packages/web/app/api/merge/route.ts` (GET `?investigation=`)
- Create: `packages/web/app/api/merge/diff/route.ts` (GET `?source=&target=` and `?mr=`)
- Modify: `packages/web/app/api/graph/route.ts` (`mergePreview` param)
- Modify: `packages/web/lib/fork.ts` `deleteFork` (withdraw open outgoing MRs; delete MRs targeting the fork)

**Interfaces (produces):**
```ts
export type MergeRequestRecord = { id; sourceId; targetId; sourceTitle; targetTitle;
  proposerId; proposerName; note; status; reviewerId; decidedAt; decisionNote; createdAt;
  counts?: { incoming: number } };
export type MergeDiff = {
  incoming: { nodes: GraphNodeData[]; edges: GraphEdgeData[]; provenance: Record<string, NodeProvenance> };
  counts: { incoming: number; shared: number; targetOnly: number } };
export async function openMergeRequest(i: {sourceId; targetId; proposerId; note?}): Promise<{id} | {error}>;
export async function decideMergeRequest(i: {mrId; reviewerId; decision: "accepted"|"declined"; decisionNote?}): Promise<{ok: true} | {error}>;
export async function withdrawMergeRequest(i: {mrId; userId}): Promise<{ok: true} | {error}>;
export async function listMergeRequests(investigationId): Promise<MergeRequestRecord[]>;
export async function computeMergeDiff(sourceId, targetId): Promise<MergeDiff>;
export async function previewHops(sourceId, targetId): Promise<ScopeHop[]>; // live source hops not in target
```

Key logic:
- `openMergeRequest` validates: source has `forkedFrom`, target is in source's ancestor chain (any ancestor, not only direct parent), no existing open MR for the pair.
- `decideMergeRequest` (accept): tx — verify reviewer is target owner + status open; compute `mergedHops = previewHops(source, target)` cutoffs min-composed with `Date.now()`; write contribution (`merge@1`, sessionId=target, contributorId=reviewer — reuse the `recordUserContribution` pattern from `lib/challenges.ts:26`); update row. Then `broadcastRoomEvent` to BOTH rooms (`merge:changed`).
- `previewHops`: `getScopeHops(source)` minus session ids already covered by target's hops.
- Server actions: auth via `requireUser` pattern from `fork-actions.ts`, `ensureContributor`, delegate to lib, broadcast.
- `deleteFork` additions inside the tx: `UPDATE merge_requests SET status='withdrawn' WHERE source_id=$id AND status='open'`; `DELETE FROM merge_requests WHERE target_id=$id`.

- [ ] Steps: implement lib → actions → routes → deleteFork → typecheck + lint → commit `feat(merge): merge requests — scope-adoption merges with receipts`.

### Task 5: Merge UI — propose dialog, MR panel, diff review + graph preview

**Files:**
- Create: `packages/web/app/_components/merge/propose-merge-dialog.tsx`
- Create: `packages/web/app/_components/merge/merge-panel.tsx` (list + review + diff)
- Modify: `packages/web/app/_components/graph-panel.tsx` (toolbar pills after `journal` at `:686`; mount panel + dialog beside `PublishTopicDialog` at `:905`; preview fetch + node styling)
- Modify: `packages/web/app/_components/graph/nodes.tsx` (incoming highlight via `data-incoming`)
- Modify: `packages/web/app/_components/graph/graph-bus.ts` (add `mergePreview: { mrId: string | null; incomingIds: string[] }`)

Integration notes:
- Graph panel owns `mergePreview` state; when set, `load()` appends `&mergePreview=<mrId>` and nodes whose id ∈ incomingIds get `data-incoming` (fuchsia/emerald ring + soft glow, defined in `app/globals.css`).
- Toolbar: fork rooms (know via `room.data.forkedFrom` — check `/api/room` payload; if absent, extend it) get `⇡ propose merge`; all rooms get `⇵ merges` pill with open-count badge (fetch `/api/merge?investigation=`; refetch on `merge:changed` via `room.channel.on`).
- Review pane: incoming nodes grouped by kind, provenance line each ("recorded by eve · method · date"), counts header, note, Accept (owner only — compare `room.data.ownerId` to identity userId; if ownerId missing from room payload, extend `/api/room`) / Decline with note / Withdraw (proposer).
- Empty diff → "nothing new to merge" and accept disabled? No — still allowed (records the review); but show the zero clearly.

- [ ] Steps: build components → wire toolbar/panel/preview → globals.css halo → typecheck + lint → commit `feat(merge): review UX with in-graph diff preview`.

### Task 6: Releases — lib, actions, routes, public page, dialog

**Files:**
- Create: `packages/web/lib/releases.ts` (`cutRelease`, `listReleases`, `getRelease`, `releaseGraph`, `citationFor`)
- Create: `packages/web/app/(chat)/release-actions.ts` (`cutReleaseAction`, `listReleasesAction` — or GET route for list; use route: `app/api/releases/route.ts?investigation=`)
- Create: `packages/web/app/api/releases/[id]/export/route.ts`
- Create: `packages/web/app/releases/[id]/page.tsx` (public, `revalidate = 300`, mirrors `app/topics/[slug]/page.tsx` structure; reuse `app/topics/_components/topic-graph-preview.tsx` if its props accept a GraphPayload, else render stat tiles + hypotheses + node list)
- Create: `packages/web/app/_components/releases/release-dialog.tsx`
- Modify: `packages/web/app/_components/graph-panel.tsx` (toolbar `🏷 release` pill in the non-commons branch; mount dialog)

Key logic:
- `cutRelease({investigationId, userId, name?, notes?})`: tx — read investigation (title), `getScopeHops`, `version = max+1`, `cutoff = new Date()`, contribution `release@1` (sessionId=investigationId), insert. Return full record.
- `releaseGraph(release)`: `buildGraphData(null, { hopsOverride: release.hops, asOf: release.cutoff })` — note investigation arg null + override supplies scope (works after room deletion).
- `citationFor(release, origin)`: plain string + BibTeX `@misc{epistack_<shortid>_v<N>, ...}`.
- Dialog: version list (link, copy citation) + cut form → success pane (URL + citation + BibTeX copy buttons) — mirror `publish-topic-dialog.tsx`'s `PublishedPane`.

- [ ] Steps: lib → routes → page → dialog + toolbar → typecheck + lint → commit `feat(releases): named citable versions with public pages + export`.

### Task 7: Parameterize commons writes by contributor

**Files:**
- Modify: `packages/web/agent/lib/commons.ts` — every write input gains `contributorId?: string`; `recordContribution(method, payload, sessionId?, turnId?, contributorId = AGENT_CONTRIBUTOR_ID)`; export `EVE_CONTRIBUTOR_ID = AGENT_CONTRIBUTOR_ID` for reuse.

All existing callers (eve tools, delegate run) unchanged — default preserves behavior.

- [ ] Steps: edit → typecheck + lint → commit `refactor(agent): contributor-parameterized commons writes`.

### Task 8: Agent keys — lib, actions, connect dialog

**Files:**
- Create: `packages/web/lib/agent-keys.ts` (`mintAgentKey`, `revokeAgentKey`, `listAgentKeys`, `resolveAgentToken`)
- Create: `packages/web/app/(chat)/agent-actions.ts`
- Create: `packages/web/app/_components/agents/connect-agent-dialog.tsx`
- Modify: sidebar footer (`packages/web/app/_components/app-sidebar.tsx`) — "Connect an agent" entry opening the dialog.

Key logic:
- `mintAgentKey({name, createdBy})`: create contributor `{kind:'agent', displayName: name}`; token `esk_` + 24 random bytes hex (`node:crypto randomBytes`); store sha256 hex; return `{token, contributorId, mcpUrl}` — token surfaces once.
- `resolveAgentToken(bearer)`: hash → row where `revokedAt IS NULL` → `{contributorId, name}` | null; opportunistically update `lastUsedAt`.
- Dialog: name input → mint → show token (copy) + MCP URL + config snippet (mirror `app/topics/_components/connect-card.tsx`); below, list of my agents (name, created, last used, revoke).

- [ ] Steps: lib → actions → dialog + sidebar → typecheck + lint → commit `feat(agents): mintable agent keys + connect dialog`.

### Task 9: Agent MCP endpoint + write tools

**Files:**
- Create: `packages/web/app/api/mcp/agent/[transport]/route.ts`
- Create: `packages/web/lib/mcp/register-agent-tools.ts`

Route (per-request handler, mirrors `[slug]/[transport]/route.ts`):

```ts
const handler = async (req: Request) => {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const agent = bearer ? await resolveAgentToken(bearer) : null;
  if (!agent) {
    return NextResponse.json(
      { error: "agent key required — mint one from the sidebar's Connect an agent" },
      { status: 401 }
    );
  }
  const origin = new URL(req.url).origin;
  return createMcpHandler(
    (server) => {
      registerCommonsTools(server, { origin, topic: null, memberIds: null });
      registerAgentTools(server, { origin, agent });
    },
    {},
    { basePath: "/api/mcp/agent", maxDuration: 60 }
  )(req);
};
```

Tools in `register-agent-tools.ts` (each write ends with `broadcastRoomEvent(investigationId, "agent-activity", {...})` and returns ids):
- `list_investigations` → `listInvestigations()` + room urls
- `create_investigation({title, seed_from_commons?})` → `upsertInvestigation({id: \`agent_${randomUUID()}\`, contributorId: agent.contributorId, ...})` (events default `[]` — verify `/api/room` boot tolerates a row with empty events + null eveSessionId; fork rows already boot pre-session, but they always have a prelude; fix room boot if it 500s on empty)
- `get_investigation_graph({investigation_id})` → `buildGraphData(id)` trimmed: counts, assessment, `nodes: [{id, kind, label}]` capped at 150
- `record_source`, `record_claim`, `record_relation`, `record_hypothesis`, `link_claim_to_hypothesis`, `record_crux` → `agent/lib/commons.ts` fns with `contributorId: agent.contributorId`, `sessionId: investigation_id` (route handler import is allowed; NOTE: this drags transformers into this route only, same as delegate)
- `record_credence({investigation_id, hypothesis_id, credence, rationale?})` → reuse the write fn in `lib/credences.ts` (read it first; it exists for the UI slider path)
- `file_challenge({investigation_id, node_id, challenge_type, body, evidence_url?})` → `resolveNodeTarget` + `fileChallenge` from `lib/challenges.ts`

- [ ] Steps: implement → typecheck + lint → commit `feat(mcp): authenticated write-capable agent endpoint`.

### Task 10: Agent liveness — chip + graph cursor

**Files:**
- Create: `packages/web/app/_components/agents/use-agent-activity.ts` (map of active agents from `agent-activity` events; expiry 75s tick)
- Modify: `packages/web/app/_components/presence/cursor-layer.tsx` (drive an `agent:<id>` cursor on events with `nodeId` — mirror how delegation-step events move the delegate cursor; narration bubble = `action` text)
- Modify: presence stack area (`presence-avatars.tsx` or its graph-toolbar usage at `graph-panel.tsx:707`) — render active-agent chips (bot glyph + name + pulse) beside human avatars.
- Modify: `packages/web/app/globals.css` if the agent cursor needs a distinct tint (reuse delegate cursor styling with a different hue).

- [ ] Steps: hook → cursor wiring → chip → typecheck + lint → commit `feat(agents): live agent presence chip + graph cursor`.

### Task 11: Docs

**Files:**
- Modify: `docs/ARCHITECTURE.md` — §3 table rows (3 tables), new §7.9 merges / §7.10 releases / §7.11 agent MCP (+ a §7.12 documenting the previously-undocumented topics/MCP vending surface), §8 HTTP table rows.
- Modify: `CLAUDE.md` — feature→file map rows for the three features.

- [ ] Steps: write → commit `docs: architecture entries for merges, releases, agent MCP, vending`.

### Task 12: Live verification (the repo's real bar)

With `supabase start` + `bun run dev`:

- [ ] Seed: sign-in flow (mail sandbox), create investigation A with a couple of claims via the agent MCP path or SQL; fork A → B; write a claim into B (agent MCP into B is fine and also exercises Task 9).
- [ ] Merge: open MR B→A via UI (or action), GET diff shows B's claim as incoming, preview highlights it, accept as A's owner → A's graph now shows it (confirm `/api/graph?investigation=A` contains the claim), MR row accepted, contribution `merge@1` present.
- [ ] Release: cut v1 on A; GET `/releases/<id>` (200, correct stats), `/api/releases/<id>/export` (JSON + citation); write another claim into A; confirm release graph does NOT grow (asOf capping) while the room graph does.
- [ ] Agent MCP: mint key via dialog; `curl` MCP initialize + `tools/list` (401 without key, 200 with); `create_investigation`, `record_hypothesis`, `record_source`+`record_claim`, `record_credence`, `file_challenge`; confirm rows + receipts + sidebar listing; with a browser open on the room, confirm the agent chip + cursor appear on writes and the graph repaints.
- [ ] `bunx tsc --noEmit && bunx biome check .` in both packages — clean.
- [ ] Commit any fixes; final commit.

## Self-review

- Spec coverage: merge semantics/permissions/deleteFork (T1,3,4,5), releases incl. public page/export/citation (T1,6), agent auth/tools/liveness (T1,2,7,8,9,10), scope math shared foundation (T3), server broadcast (T2), docs (T11), live verification (T12). ✓
- Types consistent: `ScopeHop` produced in T3, consumed T4/T6/T9; `MergeDiff` T4→T5; `resolveAgentToken` T8→T9; `broadcastRoomEvent` T2→T4/T9. ✓
- Known open verifications flagged inline (broadcast REST on local stack — T2 step 4 fallback; room boot with empty events — T9; `lib/credences.ts` write fn name — T9 reads it first).
