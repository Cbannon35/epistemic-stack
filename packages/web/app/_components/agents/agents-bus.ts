"use client";

import { useSyncExternalStore } from "react";

// Live MCP-agent state, derived from `agent-activity` broadcast recency —
// agents hold no websocket, so "online" means "acted recently". Module
// store (people-bus pattern) so the cursor layer (inside ReactFlow) can
// write it and the toolbar chips (outside) can read it.

export type ActiveAgent = {
  contributorId: string;
  name: string;
  /** The human whose key the agent runs on — shown as "on behalf of …". */
  onBehalfOfName: string | null;
  /** Pane of the latest action — the avatar sits in that pane's stack,
   * migrating with the agent's work like a human avatar follows a pointer. */
  view: "chat" | "graph";
  /** epoch ms of the latest activity event. */
  lastTs: number;
  /** Latest narration line, e.g. `recorded claim "…"`. */
  action: string;
};

type State = { agents: readonly ActiveAgent[] };

let state: State = { agents: [] };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    l();
  }
}

export const agentsBus = {
  set(agents: readonly ActiveAgent[]) {
    state = { agents };
    emit();
  },
  get(): State {
    return state;
  },
};

export function useActiveAgents(): readonly ActiveAgent[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  ).agents;
}
