"use client";

import { useRoom } from "@/app/_components/room-provider";
import { initialsFor } from "@/lib/realtime/color";

const MAX_SHOWN = 5;

// Who's in the room: stacked colored circles in the graph toolbar. Presence
// only exists once the investigation has an id (first send), so a fresh chat
// renders nothing here.
export function PresenceAvatars() {
  const { channel } = useRoom();
  const peers = [...channel.peers.values()].sort(
    (a, b) => a.joinedAt - b.joinedAt
  );
  if (peers.length === 0) {
    return null;
  }
  const shown = peers.slice(0, MAX_SHOWN);
  const overflow = peers.length - shown.length;

  return (
    <span className="fade-in -space-x-1.5 flex items-center">
      {shown.map((peer) => (
        <span
          className="flex size-5 items-center justify-center rounded-full font-medium text-[9px] text-white ring-2 ring-background"
          key={peer.userId}
          style={{ backgroundColor: peer.color }}
          title={
            peer.activity === "viewing"
              ? peer.displayName
              : `${peer.displayName} · ${peer.activity}`
          }
        >
          {initialsFor(peer.displayName)}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="flex size-5 items-center justify-center rounded-full bg-muted font-medium text-[9px] text-muted-foreground ring-2 ring-background">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
