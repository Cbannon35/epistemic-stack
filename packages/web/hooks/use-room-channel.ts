"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { colorForUser } from "@/lib/realtime/color";
import {
  type PresenceMeta,
  type RealtimeIdentity,
  ROOM_EVENTS,
  type RoomEventName,
  type RoomEventPayloads,
  roomTopic,
} from "@/lib/realtime/types";
import { createClient } from "@/lib/supabase/client";

export type RoomChannel = {
  /** Everyone present, keyed by userId (self included). */
  peers: ReadonlyMap<string, PresenceMeta>;
  send: <E extends RoomEventName>(
    event: E,
    payload: RoomEventPayloads[E]
  ) => void;
  /** Subscribe to a broadcast event; returns an unsubscribe. */
  on: <E extends RoomEventName>(
    event: E,
    handler: (payload: RoomEventPayloads[E]) => void
  ) => () => void;
  setActivity: (activity: PresenceMeta["activity"]) => void;
};

type Handler = (payload: unknown) => void;

// One Supabase Realtime channel per room: presence + broadcast. Handlers live
// in a ref-held registry so consumers can attach/detach without touching the
// channel lifecycle (which only depends on roomId + identity). StrictMode-safe:
// each effect run builds a fresh channel instance and removes it on cleanup.
export function useRoomChannel(
  roomId: string | null,
  identity: RealtimeIdentity | null
): RoomChannel {
  const [peers, setPeers] = useState<ReadonlyMap<string, PresenceMeta>>(
    new Map()
  );
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlersRef = useRef(new Map<RoomEventName, Set<Handler>>());
  const activityRef = useRef<PresenceMeta["activity"]>("viewing");
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const clientId = identity?.clientId ?? null;
  const userId = identity?.userId ?? null;
  const displayName = identity?.displayName ?? null;

  useEffect(() => {
    if (!(roomId && clientId && userId && displayName)) {
      setPeers(new Map());
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(roomTopic(roomId), {
      config: {
        // Keyed per TAB: two windows of one account are two participants.
        presence: { key: clientId },
        broadcast: { self: false, ack: false },
      },
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      setPeers(
        new Map(
          Object.entries(state)
            .filter(([, metas]) => metas.length > 0)
            .map(([key, metas]) => [key, metas[0]])
        )
      );
    });
    for (const event of ROOM_EVENTS) {
      channel.on("broadcast", { event }, ({ payload }) => {
        const handlers = handlersRef.current.get(event);
        if (handlers) {
          for (const handler of handlers) {
            handler(payload);
          }
        }
      });
    }
    channel.subscribe((status) => {
      // Re-track on every (re)join so presence survives reconnects.
      if (status === "SUBSCRIBED") {
        channel.track({
          clientId,
          userId,
          displayName,
          color: colorForUser(clientId),
          activity: activityRef.current,
          joinedAt: Date.now(),
        } satisfies PresenceMeta);
      }
    });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomId, clientId, userId, displayName]);

  const send = useCallback(
    <E extends RoomEventName>(event: E, payload: RoomEventPayloads[E]) => {
      channelRef.current?.send({ type: "broadcast", event, payload });
    },
    []
  );

  const on = useCallback(
    <E extends RoomEventName>(
      event: E,
      handler: (payload: RoomEventPayloads[E]) => void
    ) => {
      let handlers = handlersRef.current.get(event);
      if (!handlers) {
        handlers = new Set();
        handlersRef.current.set(event, handlers);
      }
      handlers.add(handler as Handler);
      return () => {
        handlers.delete(handler as Handler);
      };
    },
    []
  );

  const setActivity = useCallback((activity: PresenceMeta["activity"]) => {
    activityRef.current = activity;
    const id = identityRef.current;
    const channel = channelRef.current;
    if (channel && id) {
      channel.track({
        clientId: id.clientId,
        userId: id.userId,
        displayName: id.displayName,
        color: colorForUser(id.clientId),
        activity,
        joinedAt: Date.now(),
      } satisfies PresenceMeta);
    }
  }, []);

  return { peers, send, on, setActivity };
}
