import "server-only";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// agent/lib pulls transformers/onnxruntime — legal ONLY because this module
// is imported exclusively by route handlers (app/api/mcp/agent), where those
// packages sit in Next's serverExternalPackages. Never import this from
// server components or actions.
import {
  addSource,
  linkClaimToHypothesis,
  recordClaim,
  recordCrux,
  recordHypothesis,
  recordRelation,
} from "@/agent/lib/commons";
import type { AgentPrincipal } from "@/lib/agent-keys";
import { fileChallenge, resolveNodeTarget } from "@/lib/challenges";
import { recordCredence } from "@/lib/credences";
import { buildGraphData } from "@/lib/graph-data";
import {
  getInvestigation,
  listInvestigations,
  upsertInvestigation,
} from "@/lib/investigations";
import { broadcastRoomEvent } from "@/lib/realtime/server-broadcast";
import type { AgentActivityEvent } from "@/lib/realtime/types";

// The write-capable agent MCP surface: external agents join investigations
// (or create their own) as FIRST-CLASS multiplayer contributors. Every write
// flows through the exact code path eve uses — embedding dedup, content
// addressing, contribution receipts, sessionId scoping — attributed to the
// agent's own contributor identity. Rooms see the agent live via the
// server-broadcast `agent-activity` events each write fires.

const NODE_CATALOG_CAP = 150;
const CHALLENGE_TYPES = [
  "counter_evidence",
  "rival_interpretation",
  "methodological_objection",
] as const;

export type AgentScope = { origin: string; agent: AgentPrincipal };

function asText(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

async function requireInvestigation(id: string) {
  const inv = await getInvestigation(id);
  return inv ?? null;
}

function announce(
  scope: AgentScope,
  investigationId: string,
  action: string,
  nodeId?: string | null
): void {
  const payload: AgentActivityEvent = {
    contributorId: scope.agent.contributorId,
    name: scope.agent.name,
    onBehalfOfName: scope.agent.onBehalfOfName,
    action,
    view: "graph",
    nodeId: nodeId ?? null,
    investigationId,
    ts: Date.now(),
  };
  // Fire-and-forget: liveness is a nudge, the receipt already landed.
  broadcastRoomEvent(investigationId, "agent-activity", payload).catch(
    () => undefined
  );
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

function registerInvestigationTools(
  server: McpServer,
  scope: AgentScope
): void {
  server.registerTool(
    "list_investigations",
    {
      title: "List investigations",
      description:
        "All investigations (shared rooms) in this commons, newest first, with room urls. Use an id as investigation_id in the write tools to contribute there.",
      inputSchema: {},
    },
    async () => {
      const rows = await listInvestigations();
      return asText({
        investigations: rows.map((r) => ({
          id: r.id,
          title: r.title,
          owner: r.ownerName,
          forkedFrom: r.forkedFrom,
          url: `${scope.origin}/i/${r.id}`,
        })),
      });
    }
  );
  server.registerTool(
    "create_investigation",
    {
      title: "Create an investigation",
      description:
        "Open a new investigation room owned by this agent. It appears in every member's sidebar immediately — people can watch you build it live and join in.",
      inputSchema: {
        title: z.string().min(3).max(300),
        seed_from_commons: z.boolean().optional(),
      },
    },
    async ({ title, seed_from_commons }) => {
      const id = `agent_${randomUUID()}`;
      await upsertInvestigation({
        id,
        contributorId: scope.agent.contributorId,
        title,
        seedFromCommons: seed_from_commons ?? true,
      });
      announce(scope, id, `opened this investigation: “${clip(title)}”`);
      return asText({
        investigation_id: id,
        url: `${scope.origin}/i/${id}`,
        note: "Record hypotheses, sources, claims, relations, and cruxes here — everything lands in the shared commons with your receipts.",
      });
    }
  );
  server.registerTool(
    "get_investigation_graph",
    {
      title: "Get an investigation's graph",
      description:
        "The current graph of one investigation (its fork lineage + accepted merges included): counts, hypotheses with community credence, and a node catalog (id/kind/label) for wiring relations and links.",
      inputSchema: { investigation_id: z.string().min(1) },
    },
    async ({ investigation_id }) => {
      const inv = await requireInvestigation(investigation_id);
      if (!inv) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const graph = await buildGraphData(investigation_id);
      return asText({
        title: inv.title,
        counts: graph.counts,
        hypotheses: graph.assessment.hypotheses,
        openCruxes: graph.assessment.openCruxes,
        nodes: graph.nodes
          .slice(0, NODE_CATALOG_CAP)
          .map((n) => ({ id: n.id, kind: n.kind, label: clip(n.label, 160) })),
        truncated: graph.nodes.length > NODE_CATALOG_CAP,
      });
    }
  );
}

function registerWriteTools(server: McpServer, scope: AgentScope): void {
  const me = scope.agent.contributorId;

  server.registerTool(
    "record_source",
    {
      title: "Record a source",
      description:
        "Store a source you will cite (returns source_id). Text is content-addressed — the same document twice resolves to one source.",
      inputSchema: {
        investigation_id: z.string().min(1),
        text: z.string().min(1).describe("the source text/extract you read"),
        url: z.string().optional(),
        title: z.string().optional(),
        author: z.string().optional(),
        publisher: z.string().optional(),
        date: z.string().optional(),
      },
    },
    async ({ investigation_id, text, url, title, author, publisher, date }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const sourceId = await addSource({
        text,
        url,
        title,
        author,
        publisher,
        date,
        retrieval: { operator: "mcp-agent", agentId: me },
        sessionId: investigation_id,
        contributorId: me,
      });
      announce(
        scope,
        investigation_id,
        `recorded source ${clip(title ?? url ?? sourceId)}`,
        sourceId
      );
      return asText({ source_id: sourceId });
    }
  );

  server.registerTool(
    "record_claim",
    {
      title: "Record a claim",
      description:
        "Record ONE standalone claim tied to a source_id and a verbatim supporting quote. Embeds + dedups automatically: is_new=false means it merged into an existing claim.",
      inputSchema: {
        investigation_id: z.string().min(1),
        claim: z.string().min(3),
        source_id: z.string().min(1),
        quote: z.string().min(1).describe("verbatim quote from the source"),
        descriptors: z
          .object({
            position: z.string().optional(),
            discipline: z.string().optional(),
            evidence_type: z.string().optional(),
            era: z.string().optional(),
          })
          .optional(),
      },
    },
    async ({ investigation_id, claim, source_id, quote, descriptors }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const result = await recordClaim({
        text: claim,
        sourceId: source_id,
        quote,
        descriptors,
        sessionId: investigation_id,
        contributorId: me,
      });
      announce(
        scope,
        investigation_id,
        `recorded claim “${clip(claim)}”${result.isNew ? "" : " (merged with existing)"}`,
        result.canonicalId
      );
      return asText({
        claim_id: result.canonicalId,
        is_new: result.isNew,
        merged_similarity: result.mergedSimilarity,
      });
    }
  );

  server.registerTool(
    "record_relation",
    {
      title: "Relate two claims",
      description:
        "A typed, challengeable edge between two existing claims — what turns claims into an argument map.",
      inputSchema: {
        investigation_id: z.string().min(1),
        from_claim_id: z.string().min(1),
        to_claim_id: z.string().min(1),
        type: z.enum(["supports", "contradicts", "depends_on", "refines"]),
        rationale: z.string().optional(),
      },
    },
    async ({
      investigation_id,
      from_claim_id,
      to_claim_id,
      type,
      rationale,
    }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const result = await recordRelation({
        fromClaimId: from_claim_id,
        toClaimId: to_claim_id,
        type,
        rationale,
        sessionId: investigation_id,
        contributorId: me,
      });
      if (result.ok) {
        announce(
          scope,
          investigation_id,
          `linked two claims (${type})`,
          from_claim_id
        );
      }
      return asText(result);
    }
  );

  server.registerTool(
    "record_hypothesis",
    {
      title: "Record a hypothesis",
      description:
        "A competing explanation for the investigation's question. Returns hypothesis_id for link_claim_to_hypothesis.",
      inputSchema: {
        investigation_id: z.string().min(1),
        statement: z.string().min(3),
        answer_bearing: z.string().optional(),
      },
    },
    async ({ investigation_id, statement, answer_bearing }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const { id } = await recordHypothesis({
        statement,
        answerBearing: answer_bearing,
        sessionId: investigation_id,
        contributorId: me,
      });
      announce(
        scope,
        investigation_id,
        `proposed hypothesis “${clip(statement)}”`,
        `hyp:${id}`
      );
      return asText({ hypothesis_id: id });
    }
  );

  server.registerTool(
    "link_claim_to_hypothesis",
    {
      title: "Link a claim to a hypothesis",
      description:
        "Attach a claim as supporting/undermining a hypothesis, with diagnosticity (0..1: how much it discriminates the hypothesis from rivals).",
      inputSchema: {
        investigation_id: z.string().min(1),
        claim_id: z.string().min(1),
        hypothesis_id: z.string().min(1),
        polarity: z.enum(["supports", "undermines"]),
        diagnosticity: z.number().min(0).max(1).optional(),
      },
    },
    async ({
      investigation_id,
      claim_id,
      hypothesis_id,
      polarity,
      diagnosticity,
    }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const result = await linkClaimToHypothesis({
        claimId: claim_id,
        hypothesisId: hypothesis_id,
        polarity,
        diagnosticity,
        sessionId: investigation_id,
        contributorId: me,
      });
      if (result.ok) {
        announce(
          scope,
          investigation_id,
          `linked a claim to a hypothesis (${polarity})`,
          `hyp:${hypothesis_id}`
        );
      }
      return asText(result);
    }
  );

  server.registerTool(
    "record_crux",
    {
      title: "Record a crux",
      description:
        'An open "what would change our mind" question tied to a claim — an unanswered crux on a load-bearing claim is itself a finding.',
      inputSchema: {
        investigation_id: z.string().min(1),
        claim_id: z.string().min(1),
        question: z.string().min(3),
        implication: z.string().optional(),
      },
    },
    async ({ investigation_id, claim_id, question, implication }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const result = await recordCrux({
        claimId: claim_id,
        question,
        implication,
        sessionId: investigation_id,
        contributorId: me,
      });
      if (result.ok) {
        announce(
          scope,
          investigation_id,
          `raised crux “${clip(question)}”`,
          result.cruxId ? `crux:${result.cruxId}` : claim_id
        );
      }
      return asText(result);
    }
  );

  server.registerTool(
    "record_credence",
    {
      title: "Put a credence on the record",
      description:
        "Register this agent's belief (0-100) in a hypothesis, with an optional rationale. Append-only: your history stays; the community average uses your latest.",
      inputSchema: {
        investigation_id: z.string().min(1),
        hypothesis_id: z.string().min(1),
        credence: z.number().min(0).max(100),
        rationale: z.string().optional(),
      },
    },
    async ({ investigation_id, hypothesis_id, credence, rationale }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const bare = hypothesis_id.startsWith("hyp:")
        ? hypothesis_id.slice(4)
        : hypothesis_id;
      const result = await recordCredence({
        hypothesisId: bare,
        contributorId: me,
        value: credence,
        note: rationale,
        sessionId: investigation_id,
      });
      if (result.ok) {
        announce(
          scope,
          investigation_id,
          `registered ${Math.round(credence)}% credence`,
          `hyp:${bare}`
        );
      }
      return asText(result);
    }
  );

  server.registerTool(
    "file_challenge",
    {
      title: "File a challenge",
      description:
        "Dispute a claim, source, hypothesis, or relation with a typed challenge. Nothing is deleted — the node's contested state is derived from open challenges.",
      inputSchema: {
        investigation_id: z.string().min(1),
        node_id: z
          .string()
          .min(1)
          .describe("graph node id (claims/sources bare; hyp:/rel: prefixed)"),
        challenge_type: z.enum(CHALLENGE_TYPES),
        body: z.string().min(3),
        evidence_url: z.string().optional(),
      },
    },
    async ({
      investigation_id,
      node_id,
      challenge_type,
      body,
      evidence_url,
    }) => {
      if (!(await requireInvestigation(investigation_id))) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const target = await resolveNodeTarget(node_id);
      if (!target) {
        return asText({
          error: `no challengeable node "${node_id}" (cruxes cannot be disputed)`,
        });
      }
      const challengeId = await fileChallenge({
        contributorId: me,
        target,
        challengeType: challenge_type,
        body,
        evidenceUrl: evidence_url,
        sessionId: investigation_id,
      });
      announce(
        scope,
        investigation_id,
        `filed a ${challenge_type.replace(/_/g, " ")} challenge`,
        node_id
      );
      // Dispute badges refetch on this room event (same path the UI uses).
      broadcastRoomEvent(investigation_id, "challenges:changed", {
        nodeId: node_id,
        actorId: me,
        actorName: scope.agent.name,
        action: "challenged",
      }).catch(() => undefined);
      return asText({ challenge_id: challengeId });
    }
  );
}

export function registerAgentTools(server: McpServer, scope: AgentScope): void {
  registerInvestigationTools(server, scope);
  registerWriteTools(server, scope);
}
