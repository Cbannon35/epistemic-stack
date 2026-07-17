"use client";

import { BotIcon } from "lucide-react";
import { useActiveAgents } from "@/app/_components/agents/agents-bus";
import { colorForUser } from "@/lib/realtime/color";

// "Agents online" chips beside the human avatar stack. Honest about what
// liveness means for a websocket-less participant: present while acting,
// gone after a quiet spell. Color = the agent's identity hue, same rule as
// humans, so its cursor, receipts, and chip all match.

export function AgentChips() {
  const agents = useActiveAgents();
  if (agents.length === 0) {
    return null;
  }
  return (
    <span className="flex items-center gap-1">
      {agents.map((agent) => (
        <span
          className="fade-in flex items-center gap-1 rounded-full border border-border/60 bg-background/85 py-0.5 pr-2 pl-1 text-[10px]"
          key={agent.contributorId}
          title={`${agent.name} — ${agent.action}`}
        >
          <span
            className="flex size-4 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: colorForUser(agent.contributorId) }}
          >
            <BotIcon className="size-2.5" />
          </span>
          <span className="max-w-24 truncate">{agent.name}</span>
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
        </span>
      ))}
    </span>
  );
}
