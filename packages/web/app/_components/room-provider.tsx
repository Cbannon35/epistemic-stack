"use client";

import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { InvestigationRoom } from "@/app/(chat)/actions";
import { getForkSeed } from "@/app/(chat)/actions";
import { useLobbyPresence } from "@/hooks/use-lobby-presence";
import { type RoomChannel, useRoomChannel } from "@/hooks/use-room-channel";
import { getClientId } from "@/lib/realtime/client-id";
import type {
  LobbyMeta,
  RealtimeIdentity,
  RoomEventPayloads,
} from "@/lib/realtime/types";
import {
  type RoomIdentity,
  type RoomSnapshot,
  RoomStore,
} from "@/lib/room/room-store";

// One investigation = one room. The store tails eve's durable session stream
// (shared by every member); the Supabase channel carries presence, cursors and
// turn coordination. Remounted via `key` when the room changes.

export type RoomValue = RoomSnapshot & {
  send: (input: { message: string }) => Promise<void>;
  stop: () => void;
  me: RealtimeIdentity;
  roomId: string | null;
  /** Set while this (unsent) room is a pending fork of another investigation. */
  forkFrom: string | null;
  store: RoomStore;
  channel: RoomChannel;
  /** App-wide: who is in which room (sidebar at-a-glance avatars). */
  lobby: ReadonlyMap<string, LobbyMeta[]>;
};

const RoomContext = createContext<RoomValue | null>(null);

export function RoomProvider({
  roomId,
  initial,
  forkFrom,
  me,
  onSessionStart,
  onSaved,
  children,
}: {
  roomId: string | null;
  initial: InvestigationRoom | null;
  forkFrom: string | null;
  me: RoomIdentity;
  onSessionStart?: (sessionId: string) => void;
  onSaved?: () => void;
  children: ReactNode;
}) {
  const [store] = useState(
    () =>
      new RoomStore({
        me,
        initialState: (initial?.session as SessionState | null) ?? null,
        initialEvents:
          (initial?.events as HandleMessageStreamEvent[] | null) ?? null,
        initialAuthors: initial?.authors ?? null,
        title: initial?.title ?? null,
        forkedFrom: forkFrom ?? initial?.forkedFrom ?? null,
        forkSeedLoader: forkFrom ? () => getForkSeed(forkFrom) : undefined,
        onSessionStart,
        onSaved,
      })
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );

  // Realtime identity is per tab: two windows of one account are two cursors.
  const identity: RealtimeIdentity = {
    clientId: getClientId(),
    userId: me.userId,
    displayName: me.displayName,
  };

  // The channel follows the live session id (a new room only gets a channel —
  // presence, cursors — once its first send assigns an id).
  const liveRoomId = snapshot.session.sessionId ?? roomId;
  const channel = useRoomChannel(liveRoomId, identity);
  const lobby = useLobbyPresence(liveRoomId, identity);

  const { send: channelSend, on: channelOn } = channel;

  useEffect(() => {
    store.setBus({
      publish: (event, payload) =>
        channelSend(
          event,
          payload as RoomEventPayloads["turn:pending"] &
            RoomEventPayloads["turn:author"]
        ),
    });
    return () => store.setBus(null);
  }, [store, channelSend]);

  useEffect(() => {
    const offPending = channelOn("turn:pending", () => store.nudge());
    const offAuthor = channelOn("turn:author", (p) =>
      store.setAuthor(p.turnId, {
        contributorId: p.contributorId,
        displayName: p.displayName,
      })
    );
    return () => {
      offPending();
      offAuthor();
    };
  }, [store, channelOn]);

  const value: RoomValue = {
    ...snapshot,
    send: store.send,
    stop: store.stop,
    me: identity,
    roomId: liveRoomId,
    forkFrom,
    store,
    channel,
    lobby,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomValue {
  const ctx = useContext(RoomContext);
  if (!ctx) {
    throw new Error("useRoom must be used within RoomProvider");
  }
  return ctx;
}
