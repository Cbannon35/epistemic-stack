# Chat ↔ graph weaving — #-mentions, pings, shared views

Three features tying the conversation to the graph. No schema changes; two new
room broadcast events; all new UI in `app/_components/weave/`.

## 1. #-mention claims in chat

- **Token format:** `#[<kind>:<nodeId>|<label>]` (kind ∈ claim/source/crux/hypothesis;
  label sanitized — no `]`/`|`/newlines, ≤80 chars). The token is plain text, so it
  survives the eve round-trip untouched, and the embedded label means the model knows
  what's referenced without a lookup.
- **Composer:** typing `#` at a word boundary in the chat textarea opens a cmdk node
  picker (pattern: the challenge promotion picker) anchored above the composer, fed by
  `/api/graph?investigation=`. Selecting replaces the typed `#` with the token + space.
  Escape returns to the textarea with the `#` left as typed.
- **Rendering (both roles):** `MessagePart`'s text case pre-transforms tokens into
  markdown links `[◇ label](#epinode:<id>)` so Streamdown renders them inline without
  breaking paragraphs; a delegated click handler intercepts `a[href^="#epinode:"]`,
  prevents navigation, and emits `graphBus.focusNode` (workspace already opens the
  graph pane on that event). Chip look via a `globals.css` rule on the href prefix.

## 2. Ping gesture

- **Event:** `ping: {clientId, userId, displayName, color, x, y, ts}` (flow coords).
- **Send:** `p` (no modifiers) while the pointer is over the graph pane, same focus
  hygiene as `/` (not in inputs, chat closed), throttled to 1/600 ms. Local echo since
  broadcast is `self: false`.
- **Render:** short-lived entries in a `pingsRef` registry positioned by the existing
  rAF loop (flow → screen via the same transform read); CSS `ping-ripple` keyframe in
  the sender's identity color + a small name tag; auto-removed after ~1.8 s.

## 3. Shared views

- **Event:** `view-shared: {id, clientId, userId, displayName, color, name,
  filters:{sources,cruxes}, lensId, camera:{cx,cy,zoom}, selectedId, ts}` — camera as
  flow-space center + zoom (viewport translate is pane-size-dependent; center isn't).
- **Tray:** a `⌘ views` pill in the graph toolbar → dropdown listing views shared this
  session (sharer color dot + name + age) and a "share current view" name input.
  Persistence: localStorage per room (own + received), capped; no DB, no fabricated
  chat messages.
- **Apply:** flip filters, `lensState.setActiveId` (if the lens id resolves locally —
  saved lenses are server-listed for everyone), select node, `setCenter(cx, cy,
  {zoom, duration: 600})`.

## Files

- New: `app/_components/weave/{node-mention.tsx, node-ref.tsx, pings.tsx, views-tray.tsx}`.
- Shared (minimal, additive): `lib/realtime/types.ts` (+2 events), `agent-chat.tsx`
  (textarea hook + picker mount), `chat/message-parts.tsx` (text-case transform),
  `presence/cursor-layer.tsx` (ping wiring), `graph-panel.tsx` (snapshot/apply + tray
  mount), `globals.css` (append ping keyframes + epinode chip style).

## Punts

- Late joiners don't receive earlier shared views (ephemeral by design).
- No #-mention of edges (nodes only). No unread markers on pings.
