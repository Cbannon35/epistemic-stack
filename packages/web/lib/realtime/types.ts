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

/** Broadcast "comments:changed" — a comment was added/updated; refetch. */
export type CommentsChangedEvent = { sessionId: string };

/** Broadcast "challenges:changed" — a dispute entry landed; refetch rollups. */
export type ChallengesChangedEvent = { nodeId: string | null };

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
  "turn:pending": TurnPendingEvent;
  "turn:author": TurnAuthorEvent;
  "comments:changed": CommentsChangedEvent;
  "challenges:changed": ChallengesChangedEvent;
};

export type RoomEventName = keyof RoomEventPayloads;

export const ROOM_EVENTS: readonly RoomEventName[] = [
  "cursor",
  "cursor-chat",
  "tour-start",
  "tour-step",
  "tour-end",
  "turn:pending",
  "turn:author",
  "comments:changed",
  "challenges:changed",
];

export const roomTopic = (roomId: string) => `room:${roomId}`;

/** Cursor-registry ids for eve: one cursor per concurrent tour/answer. */
export const EVE_CURSOR_PREFIX = "eve:";
export const eveCursorId = (tourId: string) => `${EVE_CURSOR_PREFIX}${tourId}`;
export const isEveCursorId = (id: string) => id.startsWith(EVE_CURSOR_PREFIX);
