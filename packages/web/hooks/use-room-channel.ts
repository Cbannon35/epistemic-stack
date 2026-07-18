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
  /** Everyone present, one entry per CONNECTION, keyed by clientId. */
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
  /** Which pane this member is looking at — avatars follow it. */
  setView: (view: PresenceMeta["view"]) => void;
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
  const viewRef = useRef<PresenceMeta["view"]>("chat");
  // joinedAt is fixed the first time it's read (always from callbacks, so
  // render stays pure) and reused for every re-track after that.
  const joinedAtRef = useRef<number | null>(null);
  const joinedAt = useCallback(() => {
    if (joinedAtRef.current === null) {
      joinedAtRef.current = Date.now();
    }
    return joinedAtRef.current;
  }, []);
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  const clientId = identity?.clientId ?? null;
  const userId = identity?.userId ?? null;
  const displayName = identity?.displayName ?? null;

  const trackSelf = useCallback(() => {
    const id = identityRef.current;
    const channel = channelRef.current;
    if (channel && id) {
      channel.track({
        clientId: id.clientId,
        userId: id.userId,
        displayName: id.displayName,
        // Color follows the PERSON, matching their avatar everywhere.
        color: colorForUser(id.userId),
        activity: activityRef.current,
        view: viewRef.current,
        joinedAt: joinedAt(),
        updatedAt: Date.now(),
      } satisfies PresenceMeta);
    }
  }, [joinedAt]);

  useEffect(() => {
    if (!(roomId && clientId && userId && displayName)) {
      setPeers(new Map());
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(roomTopic(roomId), {
      config: {
        // One presence per CONNECTION; avatar stacks dedupe by userId.
        presence: { key: clientId },
        broadcast: { self: false, ack: false },
      },
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const next = new Map<string, PresenceMeta>();
      for (const [key, metas] of Object.entries(state)) {
        // Re-tracks APPEND metas rather than replace — the freshest
        // payload (e.g. a view change) is the LAST entry, not the first.
        const meta = metas.at(-1);
        if (meta) {
          next.set(key, meta);
        }
      }
      setPeers(next);
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
        trackSelf();
      }
    });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomId, clientId, userId, displayName, trackSelf]);

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

  const setActivity = useCallback(
    (activity: PresenceMeta["activity"]) => {
      activityRef.current = activity;
      trackSelf();
    },
    [trackSelf]
  );

  const setView = useCallback(
    (view: PresenceMeta["view"]) => {
      if (viewRef.current === view) {
        return;
      }
      viewRef.current = view;
      trackSelf();
    },
    [trackSelf]
  );

  return { peers, send, on, setActivity, setView };
}
