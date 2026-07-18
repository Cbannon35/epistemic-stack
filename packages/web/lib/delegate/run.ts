import "server-only";
import { createDb, schema } from "@epistack/db";
import { generateObject } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  addSource,
  linkClaimToHypothesis,
  recordClaim,
  recordCrux,
  recordHypothesis,
  recordRelation,
} from "@/agent/lib/commons";
import {
  searchWeb,
  type WebFinding,
  webSearchAvailable,
} from "@/lib/delegate/search";
import type {
  DelegationAdvance,
  DelegationBeat,
  DelegationLogEntry,
  DelegationSummary,
} from "@/lib/delegate/types";
import { selectEveModel } from "@/lib/eve-model";
import { buildGraphData, type GraphNodeData } from "@/lib/graph-data";

// The delegated-investigation phase machine. Each call runs ONE phase (at most
// one model call) and persists its cursor on the row, so the driving client's
// requests stay short and an interrupted run leaves an honest record:
//   start → plan (model)  →  research (Tavily fetch)  →  synthesize (model +
//   commons writes) → done.
// Writes go through agent/lib/commons — embedding dedup, receipts attributed
// to the eve agent contributor, sessionId = the room. The delegations row ties
// those receipts back to the delegator.

const db = createDb();

const MAX_CATALOG_NODES = 90;
const LABEL_CLIP = 160;
const BRIEF_CLIP = 500;
const MAX_FINDINGS = 8;
/** running rows whose heartbeat is older than this list as "interrupted". */
const HEARTBEAT_STALE_MS = 90_000;
const LIST_LIMIT = 12;

type DelegationState = {
  examine: Array<{ nodeId: string; note: string }>;
  queries: string[];
  findings: WebFinding[];
};

type OutputIds = {
  sources: string[];
  claims: string[];
  relations: number;
  cruxes: string[];
  hypotheses: string[];
  links: number;
};

// Same trimming policy as the tour route: when the graph is large, sources go
// first — a delegation plans over the argument structure.
function catalogNodes(nodes: GraphNodeData[]): GraphNodeData[] {
  if (nodes.length <= MAX_CATALOG_NODES) {
    return nodes;
  }
  const priority: Record<GraphNodeData["kind"], number> = {
    hypothesis: 0,
    crux: 1,
    claim: 2,
    source: 3,
  };
  return nodes
    .toSorted((a, b) => priority[a.kind] - priority[b.kind])
    .slice(0, MAX_CATALOG_NODES);
}

function catalogLines(catalog: GraphNodeData[]): string {
  return (
    catalog
      .map((n) => `${n.id} | ${n.kind} | ${n.label.slice(0, LABEL_CLIP)}`)
      .join("\n") || "(the graph is empty so far)"
  );
}

function logEntries(beats: DelegationBeat[]): DelegationLogEntry[] {
  const at = Date.now();
  return beats.map((b) => ({ kind: b.kind, narration: b.narration, at }));
}

async function appendRow(
  id: string,
  patch: Partial<{
    status: string;
    phase: string;
    plan: string;
    state: DelegationState;
    summary: string;
    output: OutputIds;
  }>,
  beats: DelegationBeat[],
  priorSteps: DelegationLogEntry[]
) {
  await db
    .update(schema.delegations)
    .set({
      ...patch,
      steps: [...priorSteps, ...logEntries(beats)],
      updatedAt: new Date(),
    })
    .where(eq(schema.delegations.id, id));
}

// ── start: plan the run ──────────────────────────────────────────────────────

const planSchema = z.object({
  plan: z
    .string()
    .describe("1-2 sentences: how you'll approach this brief, plainly."),
  examine: z
    .array(
      z.object({
        nodeId: z.string().describe("EXACT id copied from the catalog"),
        note: z
          .string()
          .describe("1 sentence: why this node matters to the brief"),
      })
    )
    .max(3)
    .describe(
      "1-3 existing graph nodes worth examining first. Empty if the graph has nothing relevant."
    ),
  queries: z
    .array(z.string())
    .max(2)
    .describe(
      "0-2 web search queries that would surface evidence for the brief."
    ),
});

export async function startDelegation(input: {
  sessionId: string;
  delegatorId: string;
  brief: string;
}): Promise<DelegationAdvance> {
  const brief = input.brief.trim().slice(0, BRIEF_CLIP);
  const [investigation] = await db
    .select({ id: schema.investigations.id })
    .from(schema.investigations)
    .where(eq(schema.investigations.id, input.sessionId))
    .limit(1);
  if (!investigation) {
    throw new Error(
      "investigation not found — send a first message before delegating"
    );
  }

  const graph = await buildGraphData(input.sessionId);
  const catalog = catalogNodes(graph.nodes);
  const catalogIds = new Set(catalog.map((n) => n.id));

  const { object } = await generateObject({
    model: selectEveModel(),
    schema: planSchema,
    prompt: [
      "You are eve, a research agent embedded in a live argument map (an epistemic claim graph) a team is building together.",
      `A member delegated a sub-investigation to you: "${brief}"`,
      "Plan the run: which existing nodes to examine first, and what to search the web for.",
      webSearchAvailable()
        ? "Web search is available — propose queries that would surface checkable evidence."
        : "Web search is NOT available this run: propose no queries; you can only add structure (relations, cruxes, hypotheses) over evidence already in the graph.",
      "",
      "NODE CATALOG (id | kind | label):",
      catalogLines(catalog),
    ].join("\n"),
  });

  // Hallucination guard: only visit nodes that exist.
  const examine = object.examine.filter((e) => catalogIds.has(e.nodeId));
  const queries = webSearchAvailable() ? object.queries : [];
  const state: DelegationState = { examine, queries, findings: [] };

  const beats: DelegationBeat[] = [
    { kind: "plan", nodeId: null, narration: object.plan },
    ...examine.map((e) => ({
      kind: "examine" as const,
      nodeId: e.nodeId,
      narration: e.note,
    })),
  ];

  const [row] = await db
    .insert(schema.delegations)
    .values({
      sessionId: input.sessionId,
      delegatorId: input.delegatorId,
      brief,
      status: "running",
      phase: "research",
      plan: object.plan,
      state,
      steps: logEntries(beats),
    })
    .returning({ id: schema.delegations.id });

  return { delegationId: row.id, beats, done: false };
}

// ── step: run the next phase ─────────────────────────────────────────────────

export async function stepDelegation(input: {
  delegationId: string;
  delegatorId: string;
}): Promise<DelegationAdvance> {
  const [row] = await db
    .select()
    .from(schema.delegations)
    .where(eq(schema.delegations.id, input.delegationId))
    .limit(1);
  if (!row) {
    throw new Error("delegation not found");
  }
  if (row.delegatorId !== input.delegatorId) {
    throw new Error("only the delegator drives a run");
  }
  if (row.status !== "running") {
    return {
      delegationId: row.id,
      beats: [],
      done: true,
      summary: row.summary ?? undefined,
    };
  }
  const state = (row.state ?? {
    examine: [],
    queries: [],
    findings: [],
  }) as DelegationState;
  const priorSteps = (row.steps ?? []) as DelegationLogEntry[];

  // Phase failures mark the row HERE — past the delegator check — so a
  // foreign caller's rejected request can't error someone else's run.
  try {
    if (row.phase === "research") {
      return await researchPhase(row.id, state, priorSteps);
    }
    return await synthesizePhase(
      {
        id: row.id,
        sessionId: row.sessionId,
        delegatorId: row.delegatorId,
        brief: row.brief,
        plan: row.plan,
      },
      state,
      priorSteps
    );
  } catch (error) {
    await markDelegationError(row.id);
    throw error;
  }
}

async function researchPhase(
  id: string,
  state: DelegationState,
  priorSteps: DelegationLogEntry[]
): Promise<DelegationAdvance> {
  const beats: DelegationBeat[] = [];
  const findings: WebFinding[] = [];
  if (state.queries.length === 0) {
    beats.push({
      kind: "research",
      nodeId: null,
      narration: "No web search this run — working from the existing record.",
    });
  }
  // Searches are independent reads — fan out, then fold results back in
  // query order so findings and beats stay deterministic.
  const searchResults = await Promise.all(
    state.queries.map(async (query) => ({
      query,
      results: await searchWeb(query),
    }))
  );
  for (const { query, results } of searchResults) {
    findings.push(...results);
    beats.push({
      kind: "research",
      nodeId: null,
      narration:
        results.length > 0
          ? `Searched "${query}" — ${results.length} results worth reading.`
          : `Searched "${query}" — nothing usable came back.`,
    });
  }
  const nextState: DelegationState = {
    ...state,
    findings: findings.slice(0, MAX_FINDINGS),
  };
  await appendRow(
    id,
    { phase: "synthesize", state: nextState },
    beats,
    priorSteps
  );
  return { delegationId: id, beats, done: false };
}

// ── synthesize: decide contributions, write receipts ─────────────────────────

const synthesisSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().describe("The claim, one declarative sentence."),
        quote: z
          .string()
          .describe(
            "VERBATIM substring of the finding's snippet supporting it."
          ),
        findingIndex: z
          .number()
          .int()
          .describe("Index into FINDINGS of the source this comes from."),
      })
    )
    .max(3)
    .describe("New sourced claims. ONLY from findings — no finding, no claim."),
  relations: z
    .array(
      z.object({
        from: z
          .string()
          .describe("Claim id from the catalog, or new:<i> for claims[i]."),
        to: z.string().describe("Claim id from the catalog, or new:<i>."),
        type: z.enum(["supports", "contradicts", "depends_on", "refines"]),
        rationale: z.string().describe("1 sentence: why this edge holds."),
      })
    )
    .max(2)
    .describe("Typed edges between claims."),
  links: z
    .array(
      z.object({
        claimId: z.string().describe("Claim id from the catalog, or new:<i>."),
        hypothesisId: z
          .string()
          .describe("EXACT hypothesis id from the catalog (hyp:… form)."),
        polarity: z.enum(["supports", "undermines"]),
      })
    )
    .max(2)
    .describe("Claim ↔ hypothesis bearings."),
  cruxes: z
    .array(
      z.object({
        claimId: z.string().describe("Claim id from the catalog, or new:<i>."),
        question: z.string().describe("What would change our mind about it?"),
        implication: z
          .string()
          .describe("What a yes/no would do to the picture."),
      })
    )
    .max(1)
    .describe("An open crux worth pinning, if one emerged."),
  hypothesisStatement: z
    .string()
    .describe(
      "A NEW competing explanation the evidence suggests, or empty string if none."
    ),
  summary: z
    .string()
    .describe("2-3 sentences: what you found and recorded, for the room."),
});

function clip(text: string, n = 90): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

async function synthesizePhase(
  row: {
    id: string;
    sessionId: string;
    delegatorId: string;
    brief: string;
    plan: string | null;
  },
  state: DelegationState,
  priorSteps: DelegationLogEntry[]
): Promise<DelegationAdvance> {
  const graph = await buildGraphData(row.sessionId);
  const catalog = catalogNodes(graph.nodes);
  const claimIds = new Set(
    catalog.flatMap((n) => (n.kind === "claim" ? [n.id] : []))
  );
  const hypothesisIds = new Set(
    catalog.flatMap((n) => (n.kind === "hypothesis" ? [n.id] : []))
  );
  const examined = state.examine
    .flatMap((e) => {
      const node = catalog.find((n) => n.id === e.nodeId);
      return node
        ? [
            `${node.id} | ${node.kind} | ${node.label.slice(0, LABEL_CLIP)} — ${e.note}`,
          ]
        : [];
    })
    .join("\n");
  const findingLines = state.findings
    .map(
      (f, i) =>
        `[${i}] ${f.title ?? f.url ?? "untitled"} (${f.url ?? "no url"})\n${f.snippet}`
    )
    .join("\n\n");

  const { object } = await generateObject({
    model: selectEveModel(),
    schema: synthesisSchema,
    prompt: [
      "You are eve, a research agent finishing a delegated sub-investigation on a shared epistemic claim graph. Decide what to RECORD — every write is a permanent, attributed receipt, so record only what the evidence supports.",
      `The brief: "${row.brief}"`,
      row.plan ? `Your plan was: ${row.plan}` : "",
      "Rules: claims MUST quote a finding verbatim (no findings → no new claims). Relations/links/cruxes may use existing catalog claim ids or new:<i> for a claim you are recording now. Hypothesis ids must be copied EXACTLY from the catalog.",
      "",
      examined ? `NODES YOU EXAMINED:\n${examined}` : "",
      "",
      findingLines
        ? `FINDINGS:\n${findingLines}`
        : "FINDINGS: none — add structure over existing evidence only.",
      "",
      "NODE CATALOG (id | kind | label):",
      catalogLines(catalog),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const beats: DelegationBeat[] = [];
  const output: OutputIds = {
    sources: [],
    claims: [],
    relations: 0,
    cruxes: [],
    hypotheses: [],
    links: 0,
  };
  // Source rows are content-addressed — record each used finding once.
  const sourceIdByFinding = new Map<number, string>();
  const newClaimIds: string[] = [];

  for (const candidate of object.claims) {
    const finding = state.findings[candidate.findingIndex];
    if (!finding) {
      continue; // No receipt, no claim.
    }
    let sourceId = sourceIdByFinding.get(candidate.findingIndex);
    if (!sourceId) {
      sourceId = await addSource({
        text: finding.snippet,
        url: finding.url ?? undefined,
        title: finding.title ?? undefined,
        retrieval: {
          operator: "delegated_investigation@1",
          delegationId: row.id,
          delegatorId: row.delegatorId,
          query: finding.query,
        },
        sessionId: row.sessionId,
      });
      sourceIdByFinding.set(candidate.findingIndex, sourceId);
      output.sources.push(sourceId);
    }
    const result = await recordClaim({
      text: candidate.text,
      sourceId,
      quote: candidate.quote,
      sessionId: row.sessionId,
    });
    newClaimIds.push(result.canonicalId);
    output.claims.push(result.canonicalId);
    beats.push({
      kind: "record",
      // A dedup merge lands on a node that already exists — visit it.
      nodeId: result.isNew ? null : result.canonicalId,
      narration: result.isNew
        ? `Recorded a claim: ${clip(candidate.text)}`
        : `Confirmed an existing claim: ${clip(candidate.text)}`,
    });
  }

  // new:<i> placeholders resolve to just-recorded canonical ids.
  const resolveClaimId = (id: string): string | null => {
    const match = id.match(/^new:(\d+)$/);
    if (match) {
      return newClaimIds[Number(match[1])] ?? null;
    }
    return claimIds.has(id) ? id : null;
  };

  for (const relation of object.relations) {
    const from = resolveClaimId(relation.from);
    const to = resolveClaimId(relation.to);
    if (!(from && to) || from === to) {
      continue;
    }
    const result = await recordRelation({
      fromClaimId: from,
      toClaimId: to,
      type: relation.type,
      rationale: relation.rationale,
      sessionId: row.sessionId,
    });
    if (result.ok) {
      output.relations += 1;
      beats.push({
        kind: "record",
        nodeId: from,
        narration: `Linked two claims (${relation.type}): ${clip(relation.rationale)}`,
      });
    }
  }

  for (const link of object.links) {
    const claimId = resolveClaimId(link.claimId);
    if (!(claimId && hypothesisIds.has(link.hypothesisId))) {
      continue;
    }
    const result = await linkClaimToHypothesis({
      claimId,
      hypothesisId: link.hypothesisId.replace(/^hyp:/, ""),
      polarity: link.polarity,
      sessionId: row.sessionId,
    });
    if (result.ok) {
      output.links += 1;
      beats.push({
        kind: "record",
        nodeId: link.hypothesisId,
        narration: `A claim now ${link.polarity} this hypothesis.`,
      });
    }
  }

  for (const crux of object.cruxes) {
    const claimId = resolveClaimId(crux.claimId);
    if (!claimId) {
      continue;
    }
    const result = await recordCrux({
      claimId,
      question: crux.question,
      implication: crux.implication,
      sessionId: row.sessionId,
    });
    if (result.ok && result.cruxId) {
      output.cruxes.push(result.cruxId);
      beats.push({
        kind: "record",
        nodeId: claimIds.has(claimId) ? claimId : null,
        narration: `Pinned a crux: ${clip(crux.question)}`,
      });
    }
  }

  if (object.hypothesisStatement.trim()) {
    const { id } = await recordHypothesis({
      statement: object.hypothesisStatement.trim(),
      sessionId: row.sessionId,
    });
    output.hypotheses.push(id);
    beats.push({
      kind: "record",
      nodeId: null,
      narration: `Proposed a hypothesis: ${clip(object.hypothesisStatement)}`,
    });
  }

  const wrote =
    output.claims.length +
    output.relations +
    output.links +
    output.cruxes.length +
    output.hypotheses.length;
  const summary =
    object.summary ||
    (wrote > 0
      ? `Recorded ${wrote} contribution${wrote === 1 ? "" : "s"} for "${clip(row.brief, 60)}".`
      : `Nothing met the bar to record for "${clip(row.brief, 60)}".`);
  beats.push({ kind: "conclusion", nodeId: null, narration: summary });

  await appendRow(
    row.id,
    { status: "completed", phase: "done", summary, output },
    beats,
    priorSteps
  );
  return { delegationId: row.id, beats, done: true, summary };
}

// ── cancel / error / list ────────────────────────────────────────────────────

export async function cancelDelegation(input: {
  delegationId: string;
  delegatorId: string;
}): Promise<void> {
  await db
    .update(schema.delegations)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(schema.delegations.id, input.delegationId),
        // Only the delegator cancels their run.
        eq(schema.delegations.delegatorId, input.delegatorId),
        eq(schema.delegations.status, "running")
      )
    );
}

export async function markDelegationError(delegationId: string): Promise<void> {
  await db
    .update(schema.delegations)
    .set({ status: "error", updatedAt: new Date() })
    .where(eq(schema.delegations.id, delegationId))
    .catch(() => {
      // Best-effort: the broadcast already told the room.
    });
}

export async function listDelegations(
  sessionId: string
): Promise<DelegationSummary[]> {
  const rows = await db
    .select({
      id: schema.delegations.id,
      brief: schema.delegations.brief,
      status: schema.delegations.status,
      plan: schema.delegations.plan,
      summary: schema.delegations.summary,
      delegatorId: schema.delegations.delegatorId,
      delegatorName: schema.contributors.displayName,
      steps: schema.delegations.steps,
      createdAt: schema.delegations.createdAt,
      updatedAt: schema.delegations.updatedAt,
    })
    .from(schema.delegations)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.delegations.delegatorId)
    )
    .where(eq(schema.delegations.sessionId, sessionId))
    .orderBy(desc(schema.delegations.createdAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    brief: r.brief,
    // A run whose driver vanished never gets a terminal status — report it.
    status:
      r.status === "running" &&
      Date.now() - r.updatedAt.getTime() > HEARTBEAT_STALE_MS
        ? "interrupted"
        : (r.status as DelegationSummary["status"]),
    plan: r.plan,
    summary: r.summary,
    delegatorId: r.delegatorId,
    delegatorName: r.delegatorName,
    steps: (r.steps ?? []) as DelegationLogEntry[],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
