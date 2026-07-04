"use client";

import { useRoom } from "@/app/_components/room-provider";
import { initialsFor } from "@/lib/realtime/color";
import type { PresenceMeta } from "@/lib/realtime/types";

const MAX_SHOWN = 5;

export function AvatarStack({
  people,
  size = "size-5",
  text = "text-[9px]",
}: {
  people: Array<{
    clientId: string;
    displayName: string;
    color: string;
    title?: string;
  }>;
  size?: string;
  text?: string;
}) {
  if (people.length === 0) {
    return null;
  }
  const shown = people.slice(0, MAX_SHOWN);
  const overflow = people.length - shown.length;
  return (
    <span className="fade-in -space-x-1.5 flex items-center">
      {shown.map((person) => (
        <span
          className={`flex ${size} items-center justify-center rounded-full font-medium ${text} text-white ring-2 ring-background`}
          key={person.clientId}
          style={{ backgroundColor: person.color }}
          title={person.title ?? person.displayName}
        >
          {initialsFor(person.displayName)}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={`flex ${size} items-center justify-center rounded-full bg-muted font-medium ${text} text-muted-foreground ring-2 ring-background`}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

// Who's here — filtered to the pane they're currently looking at (avatars
// follow members' pointers between chat and graph). Presence only exists once
// the investigation has an id, so a fresh chat renders nothing.
export function PresenceAvatars({ view }: { view?: PresenceMeta["view"] }) {
  const { channel } = useRoom();
  const peers = [...channel.peers.values()]
    .filter((peer) => !view || peer.view === view)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  return (
    <AvatarStack
      people={peers.map((peer) => ({
        clientId: peer.clientId,
        displayName: peer.displayName,
        color: peer.color,
        title:
          peer.activity === "viewing"
            ? peer.displayName
            : `${peer.displayName} · ${peer.activity}`,
      }))}
    />
  );
}
