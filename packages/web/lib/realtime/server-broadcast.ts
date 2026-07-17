import "server-only";
import { roomTopic } from "@/lib/realtime/types";

// Server-side broadcast onto a room channel via Supabase Realtime's REST
// endpoint — for emitters that have no browser websocket: merge decisions
// (which must notify the OTHER room's members) and MCP agents (no client at
// all). Best-effort by existing convention: realtime events are nudges, and
// clients that miss one still converge through their refetch paths.
export async function broadcastRoomEvent(
  roomId: string,
  event: string,
  payload: unknown
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
        messages: [
          { topic: roomTopic(roomId), event, payload, private: false },
        ],
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Best-effort — a lost nudge only delays a refetch.
  }
}
