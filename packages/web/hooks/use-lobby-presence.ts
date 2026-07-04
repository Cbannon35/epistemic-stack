"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { colorForUser } from "@/lib/realtime/color";
import {
  dedupeByUser,
  LOBBY_TOPIC,
  type LobbyMeta,
  type RealtimeIdentity,
} from "@/lib/realtime/types";
import { createClient } from "@/lib/supabase/client";

// One app-wide "lobby" channel every signed-in tab joins, tracking which room
// it's in. Powers the sidebar's at-a-glance avatars: see where your team is
// without joining their rooms.
export function useLobbyPresence(
  roomId: string | null,
  identity: RealtimeIdentity | null
): ReadonlyMap<string, LobbyMeta[]> {
  const [byRoom, setByRoom] = useState<ReadonlyMap<string, LobbyMeta[]>>(
    new Map()
  );
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const joinedAtRef = useRef(Date.now());

  const clientId = identity?.clientId ?? null;
  const userId = identity?.userId ?? null;
  const displayName = identity?.displayName ?? null;

  useEffect(() => {
    if (!(clientId && userId && displayName)) {
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(LOBBY_TOPIC, {
      config: { presence: { key: clientId } },
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<LobbyMeta>();
      const next = new Map<string, LobbyMeta[]>();
      for (const metas of Object.values(state)) {
        // Re-tracks APPEND metas rather than replace — take the freshest.
        const meta = metas.at(-1);
        if (!meta?.roomId) {
          continue;
        }
        const list = next.get(meta.roomId) ?? [];
        list.push(meta);
        next.set(meta.roomId, list);
      }
      // One avatar per PERSON per room, however many tabs they have open.
      for (const [key, list] of next) {
        next.set(key, dedupeByUser(list));
      }
      setByRoom(next);
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({
          clientId,
          userId,
          displayName,
          color: colorForUser(userId),
          roomId: roomIdRef.current,
          joinedAt: joinedAtRef.current,
          updatedAt: Date.now(),
        } satisfies LobbyMeta);
      }
    });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [clientId, userId, displayName]);

  // Re-track when the room changes (same channel, updated payload).
  useEffect(() => {
    const channel = channelRef.current;
    if (channel && clientId && userId && displayName) {
      channel.track({
        clientId,
        userId,
        displayName,
        color: colorForUser(userId),
        roomId,
        joinedAt: joinedAtRef.current,
        updatedAt: Date.now(),
      } satisfies LobbyMeta);
    }
  }, [roomId, clientId, userId, displayName]);

  return byRoom;
}
