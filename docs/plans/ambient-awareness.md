# Ambient awareness — ticker, catch-up digest, typing indicators

The room repaints silently today: challenges, credences, delegations, and comments arrive
with no narration, and a returning teammate gets no account of what they missed. Three
additions, all riding existing channels:

## 1. Event ticker (`app/_components/awareness/`)

An ephemeral toast stack (bottom-right of the workspace, cap 4, ~6s auto-dismiss, hover to
pause) narrating OTHER members' actions — never your own:

- challenge filed / responded — needs WHO + WHAT, so `ChallengesChangedEvent` gains optional
  `{ actorName, nodeLabel, action }` (additive; `nodeId` unchanged for existing consumers).
- comment added / replied / resolved — `CommentsChangedEvent` gains optional
  `{ actorName, action, quote }`.
- credence recorded — no broadcast exists today (propagates via graph poll), so a new
  `credence:recorded` room event carries `{ userId, displayName, hypothesisLabel, value }`.
- delegation started / finished — existing `delegation-start/-end` payloads; host names for
  `-end` resolved from a start-event registry.
- member joined / left — presence diff by PERSON (dedupeByUser), first sync skipped, 6s
  leave-grace so a refresh doesn't announce churn.
- graph growth — `graph-panel.tsx` diffs payload counts per scope and emits a local
  `graphDelta` on the graphBus ("+2 claims · +1 source"); suppressed while MY turn is the
  one writing.

## 2. Catch-up digest

`localStorage` last-seen per room+user (written on hide/unload/interval). On rejoin after
>10 min, one server action (`app/(chat)/awareness-actions.ts` → `getRoomDigest`) counts
what changed since — turns asked, claims/sources/relations/cruxes/hypotheses landed
(contribution joins, scoped to the room's fork lineage), comment activity (visibility-
filtered), dispute entries, credence updates, delegations completed — rendered as one
dismissible chip-row card above the transcript.

## 3. Typing indicators

New `typing` room broadcast `{ clientId, userId, displayName, ts }`, throttled to one per
1.5s from composer keystrokes; receivers expire entries after 4s. Rendered as a reserved
one-line slot above the composer ("‹name› is typing…"), hidden the moment a turn starts
(the header's "‹name› is asking…" takes over — never both).

## Shared-file edits (kept additive)

`lib/realtime/types.ts` (events + optional payload fields), `hooks/…` none,
`agent-chat.tsx` (digest mount, typing line, one `onChange`), `workspace.tsx` (ticker
mount), `graph-panel.tsx` (count-diff emit), `graph/graph-bus.ts` (+1 event),
`graph/inspector.tsx` (pass node label), `graph/credence-section.tsx` (broadcast after
submit), `comments/use-comments.ts` (enriched broadcast), `challenges/node-provenance.tsx`
+ `challenges/promote-to-challenge.tsx` (enriched broadcast).
