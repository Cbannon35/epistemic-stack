import "server-only";
import type { AgentPrincipal } from "@/lib/agent-keys";
import { getInvestigation } from "@/lib/investigations";
import { broadcastRoomEvent } from "@/lib/realtime/server-broadcast";
import type { AgentActivityEvent } from "@/lib/realtime/types";

// Plumbing shared by every MCP tool module — one text envelope, one clip,
// one agent scope, one liveness announcement. The tool modules split by
// concern (read surface / graph writes / room collaboration); the contract
// pieces live here so they can't drift.

export type McpTextResult = {
  content: Array<{ type: "text"; text: string }>;
};

export function asText(payload: unknown): McpTextResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export const clip = (s: string, max = 200): string =>
  s.length > max ? `${s.slice(0, max)}…` : s;

/** The authenticated agent's request context for write/collab tools. */
export type AgentScope = { origin: string; agent: AgentPrincipal };

/** Guard used by every tool that takes an investigation_id: null when the
 * room exists, otherwise the error result to return. */
export async function unknownInvestigation(
  id: string
): Promise<McpTextResult | null> {
  return (await getInvestigation(id))
    ? null
    : asText({ error: `unknown investigation ${id}` });
}

/** The agent-liveness announcement every write/collab action fires — drives
 * the room's agent avatar, cursor, and pane placement. Fire-and-forget:
 * liveness is a nudge; the receipt already landed. */
export function announce(
  scope: AgentScope,
  investigationId: string,
  action: string,
  opts: { nodeId?: string | null; view?: "chat" | "graph" } = {}
): void {
  const payload: AgentActivityEvent = {
    contributorId: scope.agent.contributorId,
    name: scope.agent.name,
    onBehalfOfName: scope.agent.onBehalfOfName,
    action,
    view: opts.view ?? "graph",
    nodeId: opts.nodeId ?? null,
    investigationId,
    ts: Date.now(),
  };
  broadcastRoomEvent(investigationId, "agent-activity", payload).catch(
    () => undefined
  );
}
