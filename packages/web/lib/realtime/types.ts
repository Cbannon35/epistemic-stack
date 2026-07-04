// Wire protocol for the per-room Supabase channel (`room:<investigationId>`).
// Presence carries who's here; broadcast carries everything that moves:
// cursors, cursor chat, the eve tour, and turn coordination for the chat.

// Identity on the realtime channel is PER TAB (clientId), not per auth user:
// the same account in two windows is two participants with two live cursors.
export type RealtimeIdentity = {
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
  joinedAt: number;
};

/** App-wide presence (one "lobby" channel): who is in which room right now. */
export type LobbyMeta = {
  clientId: string;
  userId: string;
  displayName: string;
  color: string;
  roomId: string | null;
  joinedAt: number;
};

export const LOBBY_TOPIC = "lobby";

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
];

export const roomTopic = (roomId: string) => `room:${roomId}`;

/** The synthetic presence id the eve tour cursor renders under. */
export const EVE_CURSOR_ID = "eve";
