"use client";

import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import {
  createContext,
  type ReactNode,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import type { InvestigationRoom } from "@/app/(chat)/actions";
import { getForkSeed } from "@/app/(chat)/actions";
import {
  type RoomIdentity,
  type RoomSnapshot,
  RoomStore,
} from "@/lib/room/room-store";

// One investigation = one room. The store tails eve's durable session stream
// (shared by every member); this provider is the React face of it. Remounted
// via `key` when the room changes.

export type RoomValue = RoomSnapshot & {
  send: (input: { message: string }) => Promise<void>;
  stop: () => void;
  me: RoomIdentity;
  roomId: string | null;
  store: RoomStore;
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

  const value: RoomValue = {
    ...snapshot,
    send: store.send,
    stop: store.stop,
    me,
    roomId: snapshot.session.sessionId ?? roomId,
    store,
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
