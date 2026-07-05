"use client";

import { PersonCard } from "@/app/_components/people/person-card";
import { useRoom } from "@/app/_components/room-provider";
import { initialsFor } from "@/lib/realtime/color";
import { dedupeByUser, type PresenceMeta } from "@/lib/realtime/types";

const MAX_SHOWN = 5;

type AvatarPerson = {
  userId: string;
  displayName: string;
  color: string;
  title?: string;
};

export function AvatarDot({
  person,
  size = "size-5",
  text = "text-[9px]",
}: {
  person: AvatarPerson;
  size?: string;
  text?: string;
}) {
  return (
    <span
      className={`flex ${size} items-center justify-center rounded-full font-medium ${text} text-white`}
      style={{ backgroundColor: person.color }}
      title={person.title ?? person.displayName}
    >
      {initialsFor(person.displayName)}
    </span>
  );
}

function Overflow({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-muted font-medium text-[9px] text-muted-foreground">
      +{count}
    </span>
  );
}

export function AvatarStack({
  people,
  size = "size-5",
  text = "text-[9px]",
}: {
  people: AvatarPerson[];
  size?: string;
  text?: string;
}) {
  if (people.length === 0) {
    return null;
  }
  const shown = people.slice(0, MAX_SHOWN);
  return (
    <span className="fade-in -space-x-1 flex items-center">
      {shown.map((person) => (
        <AvatarDot
          key={person.userId}
          person={person}
          size={size}
          text={text}
        />
      ))}
      <Overflow count={people.length - shown.length} />
    </span>
  );
}

// Who's here — filtered to the pane they're currently looking at (avatars
// follow members' pointers between chat and graph). Presence only exists once
// the investigation has an id, so a fresh chat renders nothing. Each avatar
// opens its person card: follow them, adopt their lens, compare beliefs.
export function PresenceAvatars({ view }: { view?: PresenceMeta["view"] }) {
  const { channel, me } = useRoom();
  // One avatar per PERSON (freshest connection wins), then filter by pane.
  const peers = dedupeByUser(channel.peers.values()).filter(
    (peer) => !view || peer.view === view
  );
  if (peers.length === 0) {
    return null;
  }
  const shown = peers.slice(0, MAX_SHOWN);
  return (
    <span className="fade-in -space-x-1 flex items-center">
      {shown.map((peer) => (
        <PersonCard
          isSelf={peer.userId === me.userId}
          key={peer.userId}
          meta={peer}
        >
          <button
            className="rounded-full outline-none transition-transform duration-150 focus-visible:ring-1 focus-visible:ring-ring active:scale-95"
            type="button"
          >
            <AvatarDot
              person={{
                userId: peer.userId,
                displayName: peer.displayName,
                color: peer.color,
                title:
                  peer.activity === "viewing"
                    ? peer.displayName
                    : `${peer.displayName} · ${peer.activity}`,
              }}
            />
          </button>
        </PersonCard>
      ))}
      <Overflow count={peers.length - shown.length} />
    </span>
  );
}
