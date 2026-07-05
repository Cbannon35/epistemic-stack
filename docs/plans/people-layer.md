# People layer — person cards, follow mode, lens presence, belief compare

Make people first-class: today a teammate is a 20px avatar and a cursor; their lens,
beliefs, and activity are scattered. One hub (the person card) + three actions.

## Pieces

1. **people-bus** (`app/_components/people/people-bus.ts`) — module external store
   (graph-bus pattern, but with state): `{ follow, compare }` + `usePeopleState()` via
   `useSyncExternalStore`, plus an `adoptLens` event the graph panel subscribes to (lens
   state lives in `useLensState` inside GraphPanel, which stays mounted at width 0%).
2. **Lens presence** — `PresenceMeta` gains optional `lensId`/`lensName`;
   `useRoomChannel` gains `setLens()` (re-tracks like `setView`); GraphPanel broadcasts
   the active lens on change. Was an explicitly punted lens-build item.
3. **Person card** (`people/person-card.tsx`) — AvatarStack gets a tiny optional `wrap`
   render-prop; `PresenceAvatars` wraps each avatar in a Popover card: name, activity +
   pane, lens (with **Adopt**), commons stats (server action, fetched on open), and
   **Follow** / **Compare beliefs** actions (hidden on self). Sidebar stacks (lobby data,
   other rooms) stay plain — the actions are room-scoped.
4. **Follow mode** (`people/follow.tsx`) — `useFollowCamera()` inside CursorLayer:
   subscribes to `cursor` broadcasts from the followed person's connections, glides the
   camera (throttled `setCenter`, tour zoom clamps); wheel/pointerdown breaks follow;
   auto-unfollow when they leave. Workspace opens the graph pane when the followed
   person's presence view flips to "graph". A bottom pill ("following ‹name› · Stop")
   sits above the tour pill.
5. **Belief compare** (`people/compare-beliefs-panel.tsx` + `app/(chat)/people-actions.ts`
   + `lib/people.ts`) — server action returns both contributors' latest credence per
   hypothesis (append-only `assessments`, latest per assessor); panel ranks by |gap|
   (biggest = the crux), rows colored by each person's identity color, click focuses the
   node via graphBus. Styled after LensDiffPanel; replaces it while open.

## Shared-file edits (kept additive for sibling merges)

`lib/realtime/types.ts` (+2 optional PresenceMeta fields), `hooks/use-room-channel.ts`
(+setLens), `presence-avatars.tsx` (+wrap slot), `graph-panel.tsx` (broadcast + adopt +
panel mount), `cursor-layer.tsx` (one hook + one pill), `workspace.tsx` (one effect).

## Punts

Sidebar lobby cards (actions are room-scoped); compare panel refetch rides mount +
manual refresh, not live credence changes.
