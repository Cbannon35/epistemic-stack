// Wire protocol for the per-room Supabase channel (`room:<investigationId>`).
// Presence carries who's here; broadcast carries everything that moves:
// cursors, cursor chat, the eve tour, and turn coordination for the chat.

// Identity is split two ways:
//  - CONNECTIONS (clientId, one per tab, sessionStorage-stable across
//    refreshes) key everything pointer-shaped: presence entries, cursors,
//    cursor chat, tour hosting. A pointer exists per window.
//  - PEOPLE (userId) are what avatars display: avatar stacks DEDUPE presence
//    by userId (freshest meta wins), and colors derive from userId so a
//    person looks the same everywhere, however many tabs they have open.
export type RealtimeIdentity = {
  /** Per-tab connection id — see lib/realtime/client-id.ts. */
  clientId: string;
  userId: string;
  displayName: string;
};

export type PresenceMeta = {
  clientId: string;
  userId: string;
  displayName: string;
  color: string;
  activity: "viewing" | "chatting" | "touring";
  /** Which pane this member's pointer is over — avatars follow it. */
  view: "chat" | "graph";
  /** The lens this member reads the graph through — person cards show it and
   * offer one-click adoption. Absent on connections predating the field. */
  lensId?: string;
  lensName?: string;
  /** Stable per connection — avatar sort order. */
  joinedAt: number;
  /** Bumped on every re-track — freshest-meta dedup. */
  updatedAt: number;
};

/** App-wide presence (one "lobby" channel): who is in which room right now. */
export type LobbyMeta = {
  clientId: string;
  userId: string;
  displayName: string;
  color: string;
  roomId: string | null;
  joinedAt: number;
  updatedAt: number;
};

export const LOBBY_TOPIC = "lobby";

/** One entry per PERSON: freshest meta per userId, ordered by join time. */
export function dedupeByUser<
  T extends { userId: string; joinedAt: number; updatedAt: number },
>(metas: Iterable<T>): T[] {
  const byUser = new Map<string, T>();
  for (const meta of metas) {
    const existing = byUser.get(meta.userId);
    if (!existing || meta.updatedAt > existing.updatedAt) {
      byUser.set(meta.userId, meta);
    }
  }
  return [...byUser.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

/** Broadcast "cursor" — pointer position in FLOW coordinates (throttled). */
export type CursorEvent =
  | { clientId: string; x: number; y: number; ts: number }
  | { clientId: string; gone: true; ts: number };

/** Broadcast "cursor-chat" — full current text per keystroke, not deltas. */
export type CursorChatEvent = {
  clientId: string;
  text: string;
  /** Enter (commit) or Escape/idle (text === "" clears the bubble). */
  done: boolean;
  ts: number;
};

export type TourStartEvent = {
  tourId: string;
  hostId: string;
  hostName: string;
  question: string;
  /** answer: a one-bubble reply at the asker's cursor; tour: a guided walk. */
  mode: "answer" | "tour";
  totalSteps: number;
  ts: number;
};

export type TourStepEvent = {
  tourId: string;
  hostId: string;
  kind: "intro" | "step" | "conclusion";
  index: number;
  total: number;
  /** null for intro/conclusion. Receivers resolve locally; x/y is fallback. */
  nodeId: string | null;
  narration: string;
  x: number;
  y: number;
  ts: number;
};

export type TourEndEvent = {
  tourId: string;
  hostId: string;
  reason: "complete" | "stopped" | "error";
  summary?: string;
  ts: number;
};

// ── delegated investigations ────────────────────────────────────────────────
// A member assigned eve a background sub-investigation; the delegating client
// hosts the run and broadcasts its progress (same shape as tours).

export type DelegationStartEvent = {
  delegationId: string;
  hostId: string;
  hostName: string;
  brief: string;
  ts: number;
};

export type DelegationStepEvent = {
  delegationId: string;
  hostId: string;
  kind: "plan" | "examine" | "research" | "record" | "conclusion";
  index: number;
  total: number;
  /** null for plan/research/conclusion. Receivers resolve locally; x/y is fallback. */
  nodeId: string | null;
  narration: string;
  x: number;
  y: number;
  ts: number;
};

export type DelegationEndEvent = {
  delegationId: string;
  hostId: string;
  reason: "complete" | "cancelled" | "error";
  summary?: string;
  ts: number;
};

/** Broadcast "ping" — a transient "look here" ripple at a graph position. */
export type PingEvent = {
  clientId: string;
  userId: string;
  displayName: string;
  color: string;
  /** Flow coordinates (same space as cursors). */
  x: number;
  y: number;
  ts: number;
};

/** Broadcast "view-shared" — a member shares their current graph framing. */
export type ViewSharedEvent = {
  id: string;
  clientId: string;
  userId: string;
  displayName: string;
  color: string;
  name: string;
  filters: { sources: boolean; cruxes: boolean };
  /** Lens applied at capture time — receivers resolve the id locally. */
  lensId: string;
  /** Camera as flow-space center + zoom (viewport translate is pane-size
   * dependent; the center is the same for everyone). */
  camera: { cx: number; cy: number; zoom: number };
  selectedId: string | null;
  ts: number;
};

/** Broadcast "comments:changed" — a comment was added/updated; refetch.
 * The optional fields feed the awareness ticker; refetch consumers only need
 * sessionId, so senders that can't cheaply name the action may omit them. */
export type CommentsChangedEvent = {
  sessionId: string;
  actorId?: string;
  actorName?: string;
  action?: "commented" | "replied" | "resolved";
  /** The highlighted passage (roots only) — ticker flavor text. */
  quote?: string;
};

/** Broadcast "challenges:changed" — a dispute entry landed; refetch rollups.
 * Optional fields feed the awareness ticker (who disputed what). */
export type ChallengesChangedEvent = {
  nodeId: string | null;
  actorId?: string;
  actorName?: string;
  nodeLabel?: string;
  action?: "challenged" | "responded";
};

/** Broadcast "credence:recorded" — a member put a belief on the record.
 * Repaints still ride the graph reload; this is awareness-ticker narration. */
export type CredenceRecordedEvent = {
  userId: string;
  displayName: string;
  hypothesisLabel: string;
  /** 0..100 as entered in the UI. */
  value: number;
  ts: number;
};

/** Broadcast "typing" — transient composer activity (throttled ~1.5s;
 * receivers expire entries after ~4s). Distinct from "turn:pending", which
 * fires once a send is actually accepted. */
export type TypingEvent = {
  clientId: string;
  userId: string;
  displayName: string;
  ts: number;
};

/** Broadcast "turn:pending" — a member's send was accepted; nudge readers. */
export type TurnPendingEvent = { displayName: string };

/** Broadcast "turn:author" — live authorship for a just-confirmed turn. */
export type TurnAuthorEvent = {
  turnId: string;
  contributorId: string;
  displayName: string;
};

export type RoomEventPayloads = {
  cursor: CursorEvent;
  "cursor-chat": CursorChatEvent;
  "tour-start": TourStartEvent;
  "tour-step": TourStepEvent;
  "tour-end": TourEndEvent;
  "delegation-start": DelegationStartEvent;
  "delegation-step": DelegationStepEvent;
  "delegation-end": DelegationEndEvent;
  ping: PingEvent;
  "view-shared": ViewSharedEvent;
  "turn:pending": TurnPendingEvent;
  "turn:author": TurnAuthorEvent;
  "comments:changed": CommentsChangedEvent;
  "challenges:changed": ChallengesChangedEvent;
  "credence:recorded": CredenceRecordedEvent;
  typing: TypingEvent;
};

export type RoomEventName = keyof RoomEventPayloads;

export const ROOM_EVENTS: readonly RoomEventName[] = [
  "cursor",
  "cursor-chat",
  "tour-start",
  "tour-step",
  "tour-end",
  "delegation-start",
  "delegation-step",
  "delegation-end",
  "ping",
  "view-shared",
  "turn:pending",
  "turn:author",
  "comments:changed",
  "challenges:changed",
  "credence:recorded",
  "typing",
];

export const roomTopic = (roomId: string) => `room:${roomId}`;

/** Cursor-registry ids for eve: one cursor per concurrent tour/answer. */
export const EVE_CURSOR_PREFIX = "eve:";
export const eveCursorId = (tourId: string) => `${EVE_CURSOR_PREFIX}${tourId}`;
export const isEveCursorId = (id: string) => id.startsWith(EVE_CURSOR_PREFIX);

/** Delegated-investigation cursors: still eve cursors (glide, sparkle), but a
 * distinct namespace so the layer can style them apart from tour cursors. */
export const DELEGATE_CURSOR_PREFIX = "eve:dg:";
export const delegateCursorId = (delegationId: string) =>
  `${DELEGATE_CURSOR_PREFIX}${delegationId}`;
