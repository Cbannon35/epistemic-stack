"use client";

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import {
  type ActiveAgent,
  agentsBus,
} from "@/app/_components/agents/agents-bus";
import { graphBus } from "@/app/_components/graph/graph-bus";
import type { EveDriver } from "@/app/_components/presence/use-tour";
import { useRoom } from "@/app/_components/room-provider";
import { agentCursorId } from "@/lib/realtime/types";

// External MCP agents as live room participants: every server-broadcast
// `agent-activity` event drives an agent cursor (same registry mechanics as
// tours/delegations) to the node it touched, with the narration as its
// bubble. Liveness = event recency; a quiet agent's cursor parks, then
// hides after IDLE_MS.

const IDLE_MS = 75_000;
const SWEEP_MS = 5000;
// The graph reload is debounced ~700ms behind the contribution insert, so a
// just-written node may not exist yet — retry the position resolve.
const RESOLVE_RETRIES = [400, 1200, 2600];

// Drives agent cursors + the agents-bus (the ONE store consumers read via
// useActiveAgents; cursor ids/names are derived from it, not mirrored).
export function useAgentActivity(eve: EveDriver): void {
  const { channel } = useRoom();
  const rf = useReactFlow();
  const agentsRef = useRef(new Map<string, ActiveAgent>());
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const publish = useCallback(() => {
    agentsBus.set(
      [...agentsRef.current.values()].sort(
        (a, b) => a.contributorId.localeCompare(b.contributorId) // stable order
      )
    );
  }, []);

  const nodeCenter = useCallback(
    (nodeId: string): { x: number; y: number } | null => {
      const node = rf.getNode(nodeId);
      if (!node) {
        return null;
      }
      return {
        x: node.position.x + (node.measured?.width ?? 200) / 2,
        y: node.position.y + (node.measured?.height ?? 60) / 2,
      };
    },
    [rf]
  );

  useEffect(
    () =>
      channel.on("agent-activity", (p) => {
        agentsRef.current.set(p.contributorId, {
          contributorId: p.contributorId,
          name: p.name,
          onBehalfOfName: p.onBehalfOfName ?? null,
          view: p.view ?? "graph",
          lastTs: Date.now(),
          action: p.action,
        });
        // Always publish: even a known agent may have MOVED panes, and the
        // stacks filter on view.
        publish();
        const cursor = agentCursorId(p.contributorId);
        eve.say(cursor, `${p.name}: ${p.action}`);
        const nodeId = p.nodeId;
        if (!nodeId) {
          return;
        }
        graphBus.emit("revealNode", { nodeId });
        const tryMove = (attempt: number) => {
          const center = nodeCenter(nodeId);
          if (center) {
            eve.move(cursor, center.x, center.y, { instant: attempt === 0 });
            return;
          }
          const delay = RESOLVE_RETRIES[attempt];
          if (delay === undefined) {
            return;
          }
          const t = setTimeout(() => {
            timersRef.current.delete(t);
            tryMove(attempt + 1);
          }, delay);
          timersRef.current.add(t);
        };
        tryMove(0);
      }),
    [channel, eve, nodeCenter, publish]
  );

  // Idle sweep: quiet agents leave the stage (cursor hides, chip drops).
  useEffect(() => {
    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, agent] of agentsRef.current) {
        if (now - agent.lastTs > IDLE_MS) {
          agentsRef.current.delete(id);
          eve.hide(agentCursorId(id));
          changed = true;
        }
      }
      if (changed) {
        publish();
      }
    }, SWEEP_MS);
    return () => clearInterval(sweep);
  }, [eve, publish]);

  // Room switch / unmount: clear everything (timers, cursors, chips).
  useEffect(() => {
    const timers = timersRef.current;
    const agents = agentsRef.current;
    return () => {
      for (const t of timers) {
        clearTimeout(t);
      }
      timers.clear();
      for (const id of agents.keys()) {
        eve.hide(agentCursorId(id));
      }
      agents.clear();
      agentsBus.set([]);
    };
  }, [eve]);
}
