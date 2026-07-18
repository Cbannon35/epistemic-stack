"use client";

import { useEffect, useMemo, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { CursorGlyph } from "@/app/_components/presence/cursor";
import { useRoom } from "@/app/_components/room-provider";
import type { PresenceMeta } from "@/lib/realtime/types";
import { dedupeByUser } from "@/lib/realtime/types";

// The cursor parking lot: members whose pointer ISN'T on the graph park here,
// as STATIC UI beside the legend — plain screen-space DOM, deliberately
// outside the flow's coordinate space, so pan/zoom never touches it. Glyphs
// only (identity is the hue; the name is a hover tooltip), stacked
// vertically. When a parked member cursor-chats (`/` works from anywhere),
// their bubble rises from their parked glyph — including your own.

const BUBBLE_FADE_MS = 4000;
const SWEEP_MS = 1000;

type Bubble = { text: string; ts: number };

/** Who's parked: one glyph per PERSON off the graph pane, ordered by join
 * time then clientId — identical lineup on every client (presence-derived). */
function parkedLineup(peers: Iterable<PresenceMeta>): PresenceMeta[] {
  return dedupeByUser([...peers].filter((peer) => peer.view !== "graph")).sort(
    (a, b) => a.joinedAt - b.joinedAt || a.clientId.localeCompare(b.clientId)
  );
}

export function ParkingLot() {
  const { channel, me } = useRoom();
  const parked = useMemo(
    () => parkedLineup(channel.peers.values()),
    [channel.peers]
  );
  const [bubbles, setBubbles] = useState<ReadonlyMap<string, Bubble>>(
    new Map()
  );

  // Bubbles ride the same cursor-chat broadcasts the live layer uses; own
  // messages arrive via the local bus (broadcasts skip self).
  const { on } = channel;
  useEffect(
    () =>
      on("cursor-chat", (p) => {
        setBubbles((prev) => {
          const next = new Map(prev);
          if (p.done && p.text === "") {
            next.delete(p.clientId);
          } else {
            next.set(p.clientId, { text: p.text, ts: Date.now() });
          }
          return next;
        });
      }),
    [on]
  );
  useEffect(
    () =>
      graphBus.on("selfCursorChat", ({ text }) => {
        setBubbles((prev) =>
          new Map(prev).set(me.clientId, { text, ts: Date.now() })
        );
      }),
    [me.clientId]
  );
  useEffect(() => {
    const sweep = setInterval(() => {
      const now = Date.now();
      setBubbles((prev) => {
        if (![...prev.values()].some((b) => now - b.ts > BUBBLE_FADE_MS)) {
          return prev;
        }
        return new Map(
          [...prev].filter(([, b]) => now - b.ts <= BUBBLE_FADE_MS)
        );
      });
    }, SWEEP_MS);
    return () => clearInterval(sweep);
  }, []);

  if (parked.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute bottom-3 left-36 z-10 flex flex-col-reverse items-start gap-1.5">
      {parked.map((peer) => {
        const bubble = bubbles.get(peer.clientId);
        return (
          <div
            className="fade-in flex items-end gap-1"
            key={peer.clientId}
            title={`${peer.displayName}${
              peer.clientId === me.clientId ? " (you)" : ""
            } · in the chat`}
          >
            <CursorGlyph color={peer.color} />
            {bubble ? (
              <div
                className="fade-in max-w-56 whitespace-pre-wrap rounded-lg rounded-bl-sm border bg-background/95 px-2 py-1 text-foreground text-xs shadow-[var(--shadow-float)] backdrop-blur"
                style={{ borderColor: peer.color }}
              >
                {bubble.text}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
