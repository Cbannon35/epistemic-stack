"use client";

import { useRoom } from "@/app/_components/room-provider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { initialsFor } from "@/lib/realtime/color";
import { dedupeByUser, type PresenceMeta } from "@/lib/realtime/types";

const MAX_SHOWN = 5;

type Person = {
  userId: string;
  displayName: string;
  color: string;
  title?: string;
};

export function AvatarStack({
  people,
  size = "size-5",
  text = "text-[9px]",
}: {
  people: Person[];
  size?: string;
  text?: string;
}) {
  if (people.length === 0) {
    return null;
  }
  const shown = people.slice(0, MAX_SHOWN);
  const overflow = people.length - shown.length;
  return (
    <span className="fade-in -space-x-1 flex items-center">
      {shown.map((person) => (
        <span
          className={`flex ${size} items-center justify-center rounded-full font-medium ${text} text-white`}
          key={person.userId}
          style={{ backgroundColor: person.color }}
          title={person.title ?? person.displayName}
        >
          {initialsFor(person.displayName)}
        </span>
      ))}
      {overflow > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-label={`${overflow} more ${overflow === 1 ? "person" : "people"}`}
              className={`flex ${size} cursor-pointer items-center justify-center rounded-full bg-muted font-medium ${text} text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground`}
              type="button"
            >
              +{overflow}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1.5">
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {people.map((person) => (
                <div
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs"
                  key={person.userId}
                >
                  <span
                    className="flex size-4 shrink-0 items-center justify-center rounded-full font-medium text-[8px] text-white"
                    style={{ backgroundColor: person.color }}
                  >
                    {initialsFor(person.displayName)}
                  </span>
                  <span className="truncate text-foreground">
                    {person.title ?? person.displayName}
                  </span>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}

// Who's here — filtered to the pane they're currently looking at (avatars
// follow members' pointers between chat and graph). Presence only exists once
// the investigation has an id, so a fresh chat renders nothing.
export function PresenceAvatars({ view }: { view?: PresenceMeta["view"] }) {
  const { channel } = useRoom();
  // One avatar per PERSON (freshest connection wins), then filter by pane.
  const peers = dedupeByUser(channel.peers.values()).filter(
    (peer) => !view || peer.view === view
  );
  return (
    <AvatarStack
      people={peers.map((peer) => ({
        userId: peer.userId,
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
