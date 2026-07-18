"use client";

import { useEffect, useMemo, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { CursorGlyph } from "@/app/_components/presence/cursor";
import { useRoom } from "@/app/_components/room-provider";
import type { PresenceMeta } from "@/lib/realtime/types";

// The cursor parking lot — static UI anchored to the legend, deliberately
// outside the flow's coordinate space so pan/zoom never touches it.
//
// Two zones, one live-message feature:
//  - IDLE ROW: off-graph members' glyphs line up left→right just above the
//    legend. Anonymous (identity is the hue; name on hover).
//  - SPEAKING FEED: when a parked member cursor-chats (`/` from anywhere),
//    their glyph ANIMATES to the legend's bottom-right and speaks its bubble.
//    The next speaker takes the bottom slot and pushes earlier speakers up —
//    a live feed, newest at the bottom. When a message expires, the glyph
//    glides back into the row.
// Every glyph is one absolutely-positioned element whose transform moves
// between zone slots with a spring transition — the same element travels.

const LEGEND_W = 132;
const LEGEND_H = 138;
const ROW_SPACING = 20;
const FEED_SPACING = 36;
const FEED_MAX = 4;
const MESSAGE_TTL_MS = 12_000;
const SWEEP_MS = 1000;

// Keyed by PERSON (userId): the lot shows one glyph per person, so a message
// from any of their connections speaks through that one glyph.
type Speech = { userId: string; text: string; ts: number };

export function ParkingLot() {
  const { channel, me } = useRoom();
  // One glyph per person; for YOURSELF the deciding view is THIS tab's meta
  // (freshest-connection dedupe could hide you behind your own other tab).
  const parked = useMemo(() => {
    const byUser = new Map<string, PresenceMeta>();
    for (const meta of channel.peers.values()) {
      if (meta.clientId === me.clientId) {
        continue; // self handled below from the own connection only
      }
      const existing = byUser.get(meta.userId);
      if (!existing || meta.updatedAt > existing.updatedAt) {
        byUser.set(meta.userId, meta);
      }
    }
    const others = [...byUser.values()].filter(
      (meta) => meta.view !== "graph" && meta.userId !== me.userId
    );
    const own = channel.peers.get(me.clientId);
    const lineup = own && own.view !== "graph" ? [own, ...others] : others;
    return lineup.sort(
      (a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId)
    );
  }, [channel.peers, me.clientId, me.userId]);

  // The feed: oldest→newest committed/live messages, one entry per person.
  const [speech, setSpeech] = useState<readonly Speech[]>([]);

  const speak = (userId: string, text: string) => {
    setSpeech((prev) => [
      ...prev.filter((s) => s.userId !== userId),
      { userId, text, ts: Date.now() },
    ]);
  };

  const { on, peers } = channel;
  useEffect(
    () =>
      on("cursor-chat", (p) => {
        const userId = peers.get(p.clientId)?.userId;
        if (!userId) {
          return;
        }
        if (p.done && p.text === "") {
          setSpeech((prev) => prev.filter((s) => s.userId !== userId));
          return;
        }
        speak(userId, p.text);
      }),
    [on, peers]
  );
  // Own messages arrive via the local bus — broadcasts skip self.
  useEffect(
    () => graphBus.on("selfCursorChat", ({ text }) => speak(me.userId, text)),
    [me.userId]
  );
  useEffect(() => {
    const sweep = setInterval(() => {
      const now = Date.now();
      setSpeech((prev) =>
        prev.some((s) => now - s.ts > MESSAGE_TTL_MS)
          ? prev.filter((s) => now - s.ts <= MESSAGE_TTL_MS)
          : prev
      );
    }, SWEEP_MS);
    return () => clearInterval(sweep);
  }, []);

  if (parked.length === 0) {
    return null;
  }

  // Slot resolution: feed position wins (newest = bottom slot 0, earlier
  // speakers pushed up); everyone else takes their idle-row index.
  const feed = speech
    .filter((s) => parked.some((p) => p.userId === s.userId))
    .slice(-FEED_MAX);
  const feedIndexOf = new Map(
    feed.map((s, i) => [s.userId, feed.length - 1 - i])
  );
  const idle = parked.filter((p) => !feedIndexOf.has(p.userId));
  const idleIndexOf = new Map(idle.map((p, i) => [p.userId, i]));

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10">
      {parked.map((peer) => {
        const feedIndex = feedIndexOf.get(peer.userId);
        const speaking = feedIndex !== undefined;
        const x = speaking
          ? LEGEND_W + 14
          : (idleIndexOf.get(peer.userId) ?? 0) * ROW_SPACING;
        const y = speaking
          ? (feedIndex as number) * FEED_SPACING
          : LEGEND_H + 12;
        const message = speech.find((s) => s.userId === peer.userId);
        return (
          <div
            className="fade-in absolute bottom-0 left-0 flex items-end gap-1.5 transition-transform duration-500 [transition-timing-function:var(--ease-spring)]"
            key={peer.clientId}
            style={{ transform: `translate(${x}px, ${-y}px)` }}
            title={`${peer.displayName}${
              peer.clientId === me.clientId ? " (you)" : ""
            } · in the chat`}
          >
            <CursorGlyph color={peer.color} />
            {speaking && message ? (
              <div
                className="fade-in max-w-56 truncate whitespace-pre rounded-lg rounded-bl-sm border bg-background/95 px-2 py-1 text-foreground text-xs shadow-[var(--shadow-float)] backdrop-blur"
                style={{ borderColor: peer.color }}
              >
                {message.text}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
