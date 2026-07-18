import "server-only";
import {
  type RoomEventName,
  type RoomEventPayloads,
  roomTopic,
} from "@/lib/realtime/types";

// Server-side broadcast onto room channels via Supabase Realtime's REST
// endpoint — for emitters that have no browser websocket: merge decisions
// (which must notify the OTHER room's members) and MCP agents (no client at
// all). Typed against the same event catalog the client uses, so a payload
// mismatch fails to compile. Best-effort by existing convention: realtime
// events are nudges, and clients that miss one still converge through their
// refetch paths.

type RoomEventMessage<E extends RoomEventName = RoomEventName> = {
  event: E;
  payload: RoomEventPayloads[E];
};

async function post(
  messages: Array<{ topic: string; event: string; payload: unknown }>
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!(url && key)) {
    return;
  }
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: messages.map((m) => ({ ...m, private: false })),
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Best-effort — a lost nudge only delays a refetch.
  }
}

export function broadcastRoomEvent<E extends RoomEventName>(
  roomId: string,
  event: E,
  payload: RoomEventPayloads[E]
): Promise<void> {
  return post([{ topic: roomTopic(roomId), event, payload }]);
}

/** Batched variant: one POST for a burst of events (delegation beats). */
export function broadcastRoomEvents(
  roomId: string,
  messages: readonly RoomEventMessage[]
): Promise<void> {
  return post(
    messages.map((m) => ({
      topic: roomTopic(roomId),
      event: m.event,
      payload: m.payload,
    }))
  );
}
