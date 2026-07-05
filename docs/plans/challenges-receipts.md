# Challenges + Receipts

Two features answering the judges' "adversarial environments" and "keep more
receipts" feedback.

## 1. Challenges — disagreement as first-class, append-only records

**Data model: challenges are `assessments` with `kind = 'challenge'`** — the
schema already reserved this. No new table; instead, additive columns:

- `assessments.sourceId` — fourth challenge target (claim / relation /
  hypothesis / **source**).
- `assessments.challengeType` — new enum `challenge_type`:
  `counter_evidence | rival_interpretation | methodological_objection`.
- `assessments.evidenceUrl` — optional URL backing a dispute or response.
- `assessments.respondsTo` — self-FK; a response to a challenge is itself an
  append-only assessment on the same target.

Why assessments and not a new table: every assessment already carries a
`contributionId` receipt, and the lens layer (late-binding trust) reads
assessments — so challenges automatically become lens-weightable inputs.

**Derived state** (never stored): a node is `undisputed` (no challenges),
`contested` (≥1 challenge with no response), or `answered` (every challenge
has ≥1 response).

**Writes** (web, `lib/challenges.ts` + `challenge-actions.ts`): every file/
respond inserts a `contribution` (method `challenge@1` /
`challenge_response@1`, payload hash, sessionId) then the assessment row —
the same receipt spine the agent uses.

**Comment → challenge promotion**: public comment threads get a "promote"
action; the user picks the target claim from a searchable list (cmdk) and the
quote + thread seed the challenge body. Private notes can't be promoted
(they'd leak).

**Surfaces**: graph nodes get a contested/answered corner badge; the graph
reload signature includes challenge counts so the existing
postgres_changes-on-contributions reload repaints; chat claim cards show a
challenge count via a batched lookup; new room broadcast
`challenges:changed` mirrors `comments:changed`.

## 2. Receipts drawer

Selecting a graph node now also shows its **chain of custody** (inside the
existing Inspector panel, via a self-contained `NodeProvenance` component):

- creating contribution: contributor (name + kind), method (`skill@version`),
  payload hash, signature presence, timestamp
- originating investigation (title + `/i/<id>` link)
- **turn attribution**: new nullable `contributions.turnId` column records the
  eve turn that produced each write (agent tools thread
  `ctx.session.turn.id`); joined through `investigation_turns` this yields
  "recorded by eve during a turn asked by <person>". Pre-existing rows have
  no turn and cannot be backfilled.
- per-mention extraction receipts for claims (who extracted, from which
  source, when)
- full challenge history for the node

## Files

- `packages/db/src/schema.ts` — additive columns + enum (migration generated
  at integration, NOT here)
- `packages/web/agent/lib/commons.ts` + `agent/tools/*` — turnId threading
- `packages/web/lib/challenges.ts`, `app/(chat)/challenge-actions.ts` — server
- `packages/web/lib/graph-data.ts` — per-node challenge aggregation
- `packages/web/app/_components/challenges/*` — provenance panel, challenge
  threads/forms, count badge, promote dialog
- small additive edits: `graph/types.ts`, `graph/nodes.tsx`, `inspector.tsx`,
  `graph-panel.tsx`, `tool-cards.tsx`, `thread-popover.tsx`,
  `lib/realtime/types.ts`
