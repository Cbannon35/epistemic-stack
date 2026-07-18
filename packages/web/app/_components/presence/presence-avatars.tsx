"use client";

import { BotIcon } from "lucide-react";
import {
  type ActiveAgent,
  useActiveAgents,
} from "@/app/_components/agents/agents-bus";
import { PersonCard } from "@/app/_components/people/person-card";
import { useRoom } from "@/app/_components/room-provider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { colorForUser, initialsFor } from "@/lib/realtime/color";
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

// An agent is a collaborator like anyone else, so it wears an avatar in the
// SAME stack — its identity hue, a bot glyph instead of initials, and a
// breathing glow while it's actively working. The popover names its operator:
// every key is minted by a human, and the room should know on whose behalf
// the agent acts.
function AgentAvatarDot({
  agent,
  size = "size-5",
}: {
  agent: ActiveAgent;
  size?: string;
}) {
  const color = colorForUser(agent.contributorId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${agent.name} (agent)`}
          className="rounded-full outline-none transition-transform duration-150 focus-visible:ring-1 focus-visible:ring-ring active:scale-95"
          type="button"
        >
          <span
            className={`agent-avatar-live flex ${size} items-center justify-center rounded-full text-white`}
            style={
              {
                backgroundColor: color,
                "--agent-color": color,
              } as React.CSSProperties
            }
          >
            <BotIcon className="size-3" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: color }}
          >
            <BotIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">{agent.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              agent
              {agent.onBehalfOfName
                ? ` · on behalf of ${agent.onBehalfOfName.split("@")[0]}`
                : ""}
            </p>
          </div>
        </div>
        <p className="mt-2 truncate text-[11px] text-muted-foreground">
          {agent.action}
        </p>
      </PopoverContent>
    </Popover>
  );
}

// The "+N" chip opens the full roster (everyone, not just the hidden tail).
function Overflow({
  people,
  size = "size-5",
  text = "text-[9px]",
}: {
  people: AvatarPerson[];
  size?: string;
  text?: string;
}) {
  const overflow = people.length - MAX_SHOWN;
  if (overflow <= 0) {
    return null;
  }
  return (
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
        <div className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain">
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
      <Overflow people={people} size={size} text={text} />
    </span>
  );
}

// Who's here — filtered to the pane they're currently looking at (avatars
// follow members' pointers between chat and graph). Presence only exists once
// the investigation has an id, so a fresh chat renders nothing. Each avatar
// opens its person card: follow them or compare beliefs.
export function PresenceAvatars({ view }: { view?: PresenceMeta["view"] }) {
  const { channel, me } = useRoom();
  // One avatar per PERSON (freshest connection wins), then filter by pane.
  const peers = dedupeByUser(channel.peers.values()).filter(
    (peer) => !view || peer.view === view
  );
  // Live MCP agents join the same stack — collaborators, not a side widget.
  // Same pane rule as humans: an agent's "pointer" is wherever its latest
  // action lives (graph writes → graph, chat/comments → chat), so the
  // avatar migrates between stacks with its work.
  const agents = useActiveAgents().filter(
    (agent) => !view || agent.view === view
  );
  if (peers.length === 0 && agents.length === 0) {
    return null;
  }
  const shown = peers.slice(0, MAX_SHOWN);
  const asPerson = (peer: (typeof peers)[number]): AvatarPerson => ({
    userId: peer.userId,
    displayName: peer.displayName,
    color: peer.color,
    title:
      peer.activity === "viewing"
        ? peer.displayName
        : `${peer.displayName} · ${peer.activity}`,
  });
  const agentAsPerson = (agent: ActiveAgent): AvatarPerson => ({
    userId: agent.contributorId,
    displayName: agent.name,
    color: colorForUser(agent.contributorId),
    title: `${agent.name} · agent${
      agent.onBehalfOfName
        ? ` on behalf of ${agent.onBehalfOfName.split("@")[0]}`
        : ""
    }`,
  });
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
            <AvatarDot person={asPerson(peer)} />
          </button>
        </PersonCard>
      ))}
      {agents.map((agent) => (
        <AgentAvatarDot agent={agent} key={agent.contributorId} />
      ))}
      <Overflow
        people={[...peers.map(asPerson), ...agents.map(agentAsPerson)]}
      />
    </span>
  );
}
