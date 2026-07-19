import "server-only";
import { createDb, schema } from "@epistack/db";
import { generateObject } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  addSource,
  foldForMatch,
  linkClaimToHypothesis,
  recordClaim,
  recordCrux,
  recordHypothesis,
  recordRelation,
} from "@/agent/lib/commons";
import { fetchSourceText } from "@/agent/lib/fetch-text";
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

// The delegated deep-ingestion phase machine. Each call runs ONE step (at most
// one model call) and persists its cursor on the row, so the driving client's
// requests stay short and an interrupted run leaves an honest record:
//
//   start → plan (model: avenues + queries)
//         → research   (search every avenue — no model)
//         → read       (one step per source: fetch FULL text, extract claims —
//                       code enforces READS_PER_AVENUE, the model can't stop early)
//         → pressure   (one step per recorded claim: pressure-test → crux questions)
//         → probe      (one step per question: search + read + extract answering
//                       claims, edge them back to the parent; unanswered → open crux)
//         → synthesize (model: relations + hypothesis + avenue-accounted summary)
//         → done.
//
// Writes go through agent/lib/commons — embedding dedup, receipts attributed
// to the eve agent contributor, sessionId = the room. The delegations row ties
// those receipts back to the delegator.

const db = createDb();

const MAX_CATALOG_NODES = 90;
const LABEL_CLIP = 160;
const BRIEF_CLIP = 500;
/** running rows whose heartbeat is older than this list as "interrupted". */
const HEARTBEAT_STALE_MS = 90_000;
const LIST_LIMIT = 12;

// ── deep-ingestion quotas (the harness enforces these; the model can't) ──────
const MAX_AVENUES = 4;
const CANDIDATES_PER_AVENUE = 10;
const READS_PER_AVENUE = 5;
const MAX_CLAIMS_PER_SOURCE = 6;
const PRESSURE_MAX_CLAIMS = 12;
const QUESTIONS_PER_CLAIM = 2;
const MAX_PROBES = 16;
const PROBE_URL_TRIES = 3;
/** chars of stored source text shown to an extract call (prefix of stored). */
const READ_TEXT_CAP = 9000;
/** chars persisted as a source's text (quote-verification corpus). */
const STORE_CAP = 60_000;

type Candidate = {
  url: string;
  title: string | null;
  snippet: string;
  query: string;
};

type AvenueState = {
  name: string;
  queries: string[];
  candidates: Candidate[];
  /** next candidate index to try reading */
  cursor: number;
  /** successful full-text reads so far */
  reads: number;
  claims: number;
};

type RecordedClaim = { id: string; text: string; avenue: string };

type PendingProbe = {
  claimId: string;
  claimText: string;
  question: string;
  implication: string;
  query: string;
};

type DelegationState = {
  examine: Array<{ nodeId: string; note: string }>;
  avenues: AvenueState[];
  avenueCursor: number;
  /** hypothesis catalog snapshot (bare ids) for read-time linking */
  hypotheses: Array<{ id: string; label: string }>;
  recorded: RecordedClaim[];
  pressureCursor: number;
  probes: PendingProbe[];
  probeCursor: number;
  output: OutputIds;
};

type OutputIds = {
  sources: string[];
  claims: string[];
  relations: number;
  cruxes: string[];
  hypotheses: string[];
  links: number;
};

function emptyOutput(): OutputIds {
  return {
    sources: [],
    claims: [],
    relations: 0,
    cruxes: [],
    hypotheses: [],
    links: 0,
  };
}

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

function clip(text: string, n = 90): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
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

// ── start: plan the run (avenues + queries) ──────────────────────────────────

const planSchema = z.object({
  plan: z
    .string()
    .describe("1-2 sentences: how you'll approach this brief, plainly."),
  avenues: z
    .array(
      z.object({
        name: z
          .string()
          .describe("2-4 word name for this avenue of consideration."),
        queries: z
          .array(z.string())
          .min(1)
          .max(2)
          .describe("1-2 concrete web search queries for this avenue."),
      })
    )
    .min(1)
    .describe(
      `The ${MAX_AVENUES} MOST decision-relevant avenues of consideration that bear on the brief — domains where evidence could come from, not candidate answers. Pick at most ${MAX_AVENUES}; merge overlapping ones. Vary stance across their queries; include the strongest case for the less popular answer.`
    ),
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
      `A member delegated a deep sub-investigation to you: "${brief}"`,
      "Plan the run: break the brief into avenues of consideration, give each concrete search queries, and pick existing nodes worth examining.",
      webSearchAvailable()
        ? "Web search is available — you will read full sources per avenue and pressure-test what you record."
        : "Web search is NOT available this run: propose NO avenues (empty array); you can only add structure (relations, cruxes, hypotheses) over evidence already in the graph.",
      "",
      "NODE CATALOG (id | kind | label):",
      catalogLines(catalog),
    ].join("\n"),
  });

  // Hallucination guard: only visit nodes that exist.
  const examine = object.examine.filter((e) => catalogIds.has(e.nodeId));
  const avenues: AvenueState[] = webSearchAvailable()
    ? // Clamp defensively: a small model overshoots the count sometimes, and
      // the schema no longer hard-rejects it (that 500'd the whole run).
      object.avenues.slice(0, MAX_AVENUES).map((a) => ({
        name: a.name,
        queries: a.queries,
        candidates: [],
        cursor: 0,
        reads: 0,
        claims: 0,
      }))
    : [];
  const hypotheses = catalog
    .filter((n) => n.kind === "hypothesis")
    .map((n) => ({ id: n.id.replace(/^hyp:/, ""), label: n.label }));
  const state: DelegationState = {
    examine,
    avenues,
    avenueCursor: 0,
    hypotheses,
    recorded: [],
    pressureCursor: 0,
    probes: [],
    probeCursor: 0,
    output: emptyOutput(),
  };

  const beats: DelegationBeat[] = [
    { kind: "plan", nodeId: null, narration: object.plan },
    ...avenues.map((a) => ({
      kind: "plan" as const,
      nodeId: null,
      narration: `Avenue: ${a.name}`,
    })),
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

// ── step: run the next phase step ────────────────────────────────────────────

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
  const state = normalizeState(row.state);
  const priorSteps = (row.steps ?? []) as DelegationLogEntry[];
  const ctx: RunContext = {
    id: row.id,
    sessionId: row.sessionId,
    delegatorId: row.delegatorId,
    brief: row.brief,
    plan: row.plan,
  };

  // Phase failures mark the row HERE — past the delegator check — so a
  // foreign caller's rejected request can't error someone else's run.
  try {
    switch (row.phase) {
      case "research":
        return await researchPhase(ctx, state, priorSteps);
      case "read":
        return await readStep(ctx, state, priorSteps);
      case "pressure":
        return await pressureStep(ctx, state, priorSteps);
      case "probe":
        return await probeStep(ctx, state, priorSteps);
      default:
        return await synthesizePhase(ctx, state, priorSteps);
    }
  } catch (error) {
    await markDelegationError(row.id);
    throw error;
  }
}

type RunContext = {
  id: string;
  sessionId: string;
  delegatorId: string;
  brief: string;
  plan: string | null;
};

/** Old rows (pre-deep-pipeline) may carry a different state shape. */
function normalizeState(raw: unknown): DelegationState {
  const s = (raw ?? {}) as Partial<DelegationState>;
  return {
    examine: s.examine ?? [],
    avenues: s.avenues ?? [],
    avenueCursor: s.avenueCursor ?? 0,
    hypotheses: s.hypotheses ?? [],
    recorded: s.recorded ?? [],
    pressureCursor: s.pressureCursor ?? 0,
    probes: s.probes ?? [],
    probeCursor: s.probeCursor ?? 0,
    output: s.output ?? emptyOutput(),
  };
}

// ── research: search every avenue (no model call) ────────────────────────────

async function researchPhase(
  ctx: RunContext,
  state: DelegationState,
  priorSteps: DelegationLogEntry[]
): Promise<DelegationAdvance> {
  const beats: DelegationBeat[] = [];
  if (state.avenues.length === 0) {
    beats.push({
      kind: "research",
      nodeId: null,
      narration: "No web search this run — working from the existing record.",
    });
    await appendRow(ctx.id, { phase: "synthesize", state }, beats, priorSteps);
    return { delegationId: ctx.id, beats, done: false };
  }

  // Searches are independent reads — fan out, then fold results back in
  // avenue/query order so candidates and beats stay deterministic.
  const results = await Promise.all(
    state.avenues.map(async (avenue) => {
      const perQuery = await Promise.all(
        avenue.queries.map((q) => searchWeb(q))
      );
      return { avenue, findings: perQuery.flat() };
    })
  );
  const seenUrls = new Set<string>();
  for (const { avenue, findings } of results) {
    const candidates: Candidate[] = [];
    for (const f of findings) {
      if (!f.url || seenUrls.has(f.url)) {
        continue;
      }
      seenUrls.add(f.url);
      candidates.push({
        url: f.url,
        title: f.title,
        snippet: f.snippet,
        query: f.query,
      });
      if (candidates.length >= CANDIDATES_PER_AVENUE) {
        break;
      }
    }
    avenue.candidates = candidates;
    beats.push({
      kind: "research",
      nodeId: null,
      narration: `${avenue.name}: ${candidates.length} sources to read.`,
    });
  }
  await appendRow(ctx.id, { phase: "read", state }, beats, priorSteps);
  return { delegationId: ctx.id, beats, done: false };
}

// ── read: one full-text source per step, claims extracted ────────────────────

const extractSchema = z.object({
  relevant: z
    .boolean()
    .describe("Does this source actually bear on the brief?"),
  claims: z
    .array(
      z.object({
        text: z
          .string()
          .describe(
            "ONE standalone declarative sentence — no pronouns, no bundling."
          ),
        quote: z
          .string()
          .describe("VERBATIM span copied exactly from the source text."),
        hypothesisId: z
          .string()
          .describe(
            "EXACT id of a listed hypothesis this claim bears on, or empty string."
          ),
        polarity: z.enum(["supports", "undermines"]),
      })
    )
    .max(MAX_CLAIMS_PER_SOURCE)
    .describe(
      "The atomic claims this source asserts that bear on the brief. Only what the source says — never your own synthesis."
    ),
});

function nextReadTarget(
  state: DelegationState
): { avenue: AvenueState; candidate: Candidate } | null {
  while (state.avenueCursor < state.avenues.length) {
    const avenue = state.avenues[state.avenueCursor];
    if (
      avenue.reads >= READS_PER_AVENUE ||
      avenue.cursor >= avenue.candidates.length
    ) {
      state.avenueCursor += 1;
      continue;
    }
    const candidate = avenue.candidates[avenue.cursor];
    avenue.cursor += 1;
    return { avenue, candidate };
  }
  return null;
}

async function readStep(
  ctx: RunContext,
  state: DelegationState,
  priorSteps: DelegationLogEntry[]
): Promise<DelegationAdvance> {
  const target = nextReadTarget(state);
  if (!target) {
    const beats: DelegationBeat[] = [
      {
        kind: "research",
        nodeId: null,
        narration: `Reading done — ${state.recorded.length} claims recorded. Pressure-testing them now.`,
      },
    ];
    await appendRow(ctx.id, { phase: "pressure", state }, beats, priorSteps);
    return { delegationId: ctx.id, beats, done: false };
  }

  const { avenue, candidate } = target;
  const beats: DelegationBeat[] = [];
  const fetched = await fetchSourceText(candidate.url);
  if (!fetched) {
    beats.push({
      kind: "research",
      nodeId: null,
      narration: `Couldn't read ${clip(candidate.title ?? candidate.url, 70)} — skipping.`,
    });
    await appendRow(ctx.id, { state }, beats, priorSteps);
    return { delegationId: ctx.id, beats, done: false };
  }

  const stored = fetched.text.slice(0, STORE_CAP);
  const view = stored.slice(0, READ_TEXT_CAP);
  const hypothesisLines = state.hypotheses
    .map((h) => `${h.id} | ${clip(h.label, 120)}`)
    .join("\n");
  const { object } = await generateObject({
    model: selectEveModel(),
    schema: extractSchema,
    prompt: [
      `You are eve, reading one source in full for the "${avenue.name}" avenue of a delegated investigation: "${ctx.brief}"`,
      'Extract the atomic claims this source asserts that bear on the brief. Each needs a VERBATIM quote copied exactly from the text below. Keep caveats ("only at high intake") inside the claim text.',
      hypothesisLines
        ? `HYPOTHESES (id | statement) — set hypothesisId+polarity when a claim bears on one, else empty string:\n${hypothesisLines}`
        : "No hypotheses recorded yet — leave hypothesisId as an empty string.",
      "",
      `SOURCE: ${candidate.title ?? candidate.url}`,
      view,
    ].join("\n"),
  });

  beats.push({
    kind: "research",
    nodeId: null,
    narration: `Read ${clip(candidate.title ?? candidate.url, 70)} (${avenue.name}).`,
  });

  if (object.relevant && object.claims.length > 0) {
    const sourceId = await addSource({
      text: stored,
      url: candidate.url,
      title: candidate.title ?? undefined,
      retrieval: {
        operator: "delegated_read@1",
        delegationId: ctx.id,
        delegatorId: ctx.delegatorId,
        query: candidate.query,
        avenue: avenue.name,
        via: fetched.via,
      },
      sessionId: ctx.sessionId,
    });
    const foldedView = foldForMatch(view);
    const hypothesisIds = new Set(state.hypotheses.map((h) => h.id));
    let landed = 0;
    for (const candidateClaim of object.claims) {
      const quote = foldForMatch(candidateClaim.quote);
      if (!(quote && foldedView.includes(quote))) {
        continue; // invented quote — no receipt, no claim
      }
      const result = await recordClaim({
        text: candidateClaim.text,
        sourceId,
        quote: candidateClaim.quote,
        descriptors: { avenue: avenue.name },
        sessionId: ctx.sessionId,
        sourceVerified: true,
      });
      if (!result.ok) {
        continue;
      }
      landed += 1;
      avenue.claims += 1;
      if (!state.output.sources.includes(sourceId)) {
        state.output.sources.push(sourceId);
      }
      state.output.claims.push(result.canonicalId);
      state.recorded.push({
        id: result.canonicalId,
        text: candidateClaim.text,
        avenue: avenue.name,
      });
      beats.push({
        kind: "record",
        nodeId: result.isNew ? null : result.canonicalId,
        narration: result.isNew
          ? `Recorded: ${clip(candidateClaim.text)}`
          : `Confirmed existing: ${clip(candidateClaim.text)}`,
      });
      if (
        candidateClaim.hypothesisId &&
        hypothesisIds.has(candidateClaim.hypothesisId)
      ) {
        const link = await linkClaimToHypothesis({
          claimId: result.canonicalId,
          hypothesisId: candidateClaim.hypothesisId,
          polarity: candidateClaim.polarity,
          sessionId: ctx.sessionId,
        });
        if (link.ok) {
          state.output.links += 1;
        }
      }
    }
    avenue.reads += 1;
    if (landed === 0) {
      beats.push({
        kind: "research",
        nodeId: null,
        narration: "No verifiable claims landed from this one.",
      });
    }
  } else {
    // An unreadable-in-substance source doesn't count toward the read quota.
    beats.push({
      kind: "research",
      nodeId: null,
      narration: "Not actually relevant — moving on.",
    });
  }

  await appendRow(ctx.id, { state }, beats, priorSteps);
  return { delegationId: ctx.id, beats, done: false };
}

// ── pressure: pressure-test each recorded claim into crux questions ──────────

const pressureSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z
          .string()
          .describe("A concrete, researchable question — not 'consider…'."),
        implication: z
          .string()
          .describe(
            "What an answer would do to the claim: weakens / strengthens / reverses, and why."
          ),
        query: z
          .string()
          .describe("One concrete web search query to research it."),
      })
    )
    .max(QUESTIONS_PER_CLAIM)
    .describe(
      "The 1-2 questions whose answers would MOST change our confidence in the claim. Probe the joints: would this hold anyway (baseline)? does it actually connect (driver)? is the stated reason the real reason (mechanism)? is it as big as claimed (stakes)? could it run the OPPOSITE way?"
    ),
});

async function pressureStep(
  ctx: RunContext,
  state: DelegationState,
  priorSteps: DelegationLogEntry[]
): Promise<DelegationAdvance> {
  const limit = Math.min(state.recorded.length, PRESSURE_MAX_CLAIMS);
  if (state.pressureCursor >= limit || state.probes.length >= MAX_PROBES) {
    const beats: DelegationBeat[] = [
      {
        kind: "research",
        nodeId: null,
        narration: `Pressure-testing done — ${state.probes.length} open questions to research.`,
      },
    ];
    await appendRow(ctx.id, { phase: "probe", state }, beats, priorSteps);
    return { delegationId: ctx.id, beats, done: false };
  }

  const claim = state.recorded[state.pressureCursor];
  state.pressureCursor += 1;
  const { object } = await generateObject({
    model: selectEveModel(),
    schema: pressureSchema,
    prompt: [
      "You are eve, pressure-testing a claim just recorded during a delegated investigation.",
      `The claim: "${claim.text}"`,
      `Investigation brief: "${ctx.brief}"`,
      "Produce the questions whose answers would most change our confidence in this claim.",
    ].join("\n"),
  });

  const beats: DelegationBeat[] = [];
  for (const q of object.questions) {
    if (state.probes.length >= MAX_PROBES) {
      break;
    }
    state.probes.push({
      claimId: claim.id,
      claimText: claim.text,
      question: q.question,
      implication: q.implication,
      query: q.query,
    });
  }
  beats.push({
    kind: "examine",
    nodeId: claim.id,
    narration: `Pressure-testing: ${clip(claim.text, 80)} → ${object.questions.length} question${object.questions.length === 1 ? "" : "s"}.`,
  });
  await appendRow(ctx.id, { state }, beats, priorSteps);
  return { delegationId: ctx.id, beats, done: false };
}

// ── probe: research each crux question; answers become claims + edges ────────

const probeSchema = z.object({
  answered: z
    .enum(["full", "partial", "no"])
    .describe("Does this source actually answer the question?"),
  claims: z
    .array(
      z.object({
        text: z
          .string()
          .describe("ONE standalone declarative sentence from the source."),
        quote: z
          .string()
          .describe("VERBATIM span copied exactly from the source text."),
        effect: z
          .enum(["supports", "contradicts", "neutral"])
          .describe("Effect on the PARENT claim, taken as true."),
      })
    )
    .max(3)
    .describe("Claims from this source that bear on the question."),
});

async function probeStep(
  ctx: RunContext,
  state: DelegationState,
  priorSteps: DelegationLogEntry[]
): Promise<DelegationAdvance> {
  if (state.probeCursor >= state.probes.length) {
    const beats: DelegationBeat[] = [
      {
        kind: "research",
        nodeId: null,
        narration: "Crux research done — synthesizing.",
      },
    ];
    await appendRow(ctx.id, { phase: "synthesize", state }, beats, priorSteps);
    return { delegationId: ctx.id, beats, done: false };
  }

  const probe = state.probes[state.probeCursor];
  state.probeCursor += 1;
  const beats: DelegationBeat[] = [
    {
      kind: "examine",
      nodeId: probe.claimId,
      narration: `Researching: ${clip(probe.question, 90)}`,
    },
  ];

  // Search, then read the first extractable result (bounded tries).
  const findings = await searchWeb(probe.query);
  let fetched: { text: string; via: string } | null = null;
  let used: WebFinding | null = null;
  for (const f of findings.slice(0, PROBE_URL_TRIES)) {
    if (!f.url) {
      continue;
    }
    fetched = await fetchSourceText(f.url);
    if (fetched) {
      used = f;
      break;
    }
  }

  if (!(fetched && used)) {
    // Nothing readable came back — the question stands as an open crux.
    const result = await recordCrux({
      claimId: probe.claimId,
      question: probe.question,
      implication: probe.implication,
      sessionId: ctx.sessionId,
    });
    if (result.ok && result.cruxId) {
      state.output.cruxes.push(result.cruxId);
    }
    beats.push({
      kind: "record",
      nodeId: probe.claimId,
      narration: `Unanswered — pinned as an open crux: ${clip(probe.question, 70)}`,
    });
    await appendRow(ctx.id, { state }, beats, priorSteps);
    return { delegationId: ctx.id, beats, done: false };
  }

  const stored = fetched.text.slice(0, STORE_CAP);
  const view = stored.slice(0, READ_TEXT_CAP);
  const { object } = await generateObject({
    model: selectEveModel(),
    schema: probeSchema,
    prompt: [
      "You are eve, researching a question raised while pressure-testing a claim.",
      `Parent claim: "${probe.claimText}"`,
      `The question: "${probe.question}"`,
      `Its implication: ${probe.implication}`,
      "Below is the full text of a source. Extract up to 3 atomic claims from it that bear on the question — VERBATIM quote each — and judge each one's effect on the parent claim.",
      "",
      `SOURCE: ${used.title ?? used.url}`,
      view,
    ].join("\n"),
  });

  let landed = 0;
  if (object.claims.length > 0) {
    const sourceId = await addSource({
      text: stored,
      url: used.url ?? undefined,
      title: used.title ?? undefined,
      retrieval: {
        operator: "delegated_probe@1",
        delegationId: ctx.id,
        delegatorId: ctx.delegatorId,
        query: probe.query,
        cruxQuestion: probe.question,
        via: fetched.via,
      },
      sessionId: ctx.sessionId,
    });
    const foldedView = foldForMatch(view);
    for (const candidate of object.claims) {
      const quote = foldForMatch(candidate.quote);
      if (!(quote && foldedView.includes(quote))) {
        continue;
      }
      const result = await recordClaim({
        text: candidate.text,
        sourceId,
        quote: candidate.quote,
        sessionId: ctx.sessionId,
        sourceVerified: true,
      });
      if (!result.ok) {
        continue;
      }
      landed += 1;
      if (!state.output.sources.includes(sourceId)) {
        state.output.sources.push(sourceId);
      }
      state.output.claims.push(result.canonicalId);
      beats.push({
        kind: "record",
        nodeId: result.isNew ? null : result.canonicalId,
        narration: `Found: ${clip(candidate.text)}`,
      });
      // The answer edges back to the claim it pressure-tests.
      if (
        candidate.effect !== "neutral" &&
        result.canonicalId !== probe.claimId
      ) {
        const rel = await recordRelation({
          fromClaimId: result.canonicalId,
          toClaimId: probe.claimId,
          type: candidate.effect,
          rationale: `Answers the crux question: ${clip(probe.question, 100)}`,
          sessionId: ctx.sessionId,
        });
        if (rel.ok) {
          state.output.relations += 1;
        }
      }
    }
  }

  if (landed === 0 || object.answered === "no") {
    // Searched but not settled — record the crux so the residual uncertainty
    // is visible (searched-and-unfound is a finding, not a failure).
    const result = await recordCrux({
      claimId: probe.claimId,
      question: probe.question,
      implication: probe.implication,
      sessionId: ctx.sessionId,
    });
    if (result.ok && result.cruxId) {
      state.output.cruxes.push(result.cruxId);
      beats.push({
        kind: "record",
        nodeId: probe.claimId,
        narration: `Still open — pinned as a crux: ${clip(probe.question, 70)}`,
      });
    }
  }

  await appendRow(ctx.id, { state }, beats, priorSteps);
  return { delegationId: ctx.id, beats, done: false };
}

// ── synthesize: relations + hypothesis + avenue-accounted summary ────────────

const synthesisSchema = z.object({
  relations: z
    .array(
      z.object({
        from: z
          .string()
          .describe("Claim id from the RECORDED or CATALOG list."),
        to: z.string().describe("Claim id from the RECORDED or CATALOG list."),
        type: z.enum(["supports", "contradicts", "depends_on", "refines"]),
        rationale: z.string().describe("1 sentence: why this edge holds."),
      })
    )
    .max(4)
    .describe("Typed edges between claims that clearly bear on each other."),
  hypothesisStatement: z
    .string()
    .describe(
      "A NEW competing explanation the evidence suggests, or empty string if none."
    ),
  summary: z
    .string()
    .describe(
      "3-5 sentences for the room: what was found; then account avenue by avenue (sources read, claims recorded, thin or empty avenues); then what's still open."
    ),
});

async function synthesizePhase(
  ctx: RunContext,
  state: DelegationState,
  priorSteps: DelegationLogEntry[]
): Promise<DelegationAdvance> {
  const graph = await buildGraphData(ctx.sessionId);
  const catalog = catalogNodes(graph.nodes);
  const claimIds = new Set(
    catalog.flatMap((n) => (n.kind === "claim" ? [n.id] : []))
  );
  for (const r of state.recorded) {
    claimIds.add(r.id);
  }
  const recordedLines = state.recorded
    .map((r) => `${r.id} | [${r.avenue}] ${clip(r.text, LABEL_CLIP)}`)
    .join("\n");
  const avenueLines = state.avenues
    .map(
      (a) =>
        `${a.name}: ${a.reads} sources read, ${a.claims} claims${a.candidates.length === 0 ? " (no sources found)" : ""}`
    )
    .join("\n");

  const { object } = await generateObject({
    model: selectEveModel(),
    schema: synthesisSchema,
    prompt: [
      "You are eve, finishing a delegated deep investigation on a shared epistemic claim graph. Claims, sources, hypothesis links, and cruxes are ALREADY recorded — your job now is final structure and the report.",
      `The brief: "${ctx.brief}"`,
      ctx.plan ? `Your plan was: ${ctx.plan}` : "",
      "",
      avenueLines ? `AVENUE ACCOUNTING:\n${avenueLines}` : "",
      "",
      recordedLines
        ? `RECORDED THIS RUN (id | [avenue] text):\n${recordedLines}`
        : "RECORDED THIS RUN: nothing — no readable sources produced verifiable claims.",
      "",
      "NODE CATALOG (id | kind | label):",
      catalogLines(catalog),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const beats: DelegationBeat[] = [];
  for (const relation of object.relations) {
    const from = claimIds.has(relation.from) ? relation.from : null;
    const to = claimIds.has(relation.to) ? relation.to : null;
    if (!(from && to) || from === to) {
      continue;
    }
    const result = await recordRelation({
      fromClaimId: from,
      toClaimId: to,
      type: relation.type,
      rationale: relation.rationale,
      sessionId: ctx.sessionId,
    });
    if (result.ok) {
      state.output.relations += 1;
      beats.push({
        kind: "record",
        nodeId: from,
        narration: `Linked two claims (${relation.type}): ${clip(relation.rationale)}`,
      });
    }
  }

  if (object.hypothesisStatement.trim()) {
    const { id } = await recordHypothesis({
      statement: object.hypothesisStatement.trim(),
      sessionId: ctx.sessionId,
    });
    state.output.hypotheses.push(id);
    beats.push({
      kind: "record",
      nodeId: null,
      narration: `Proposed a hypothesis: ${clip(object.hypothesisStatement)}`,
    });
  }

  const output = state.output;
  const wrote =
    output.claims.length +
    output.relations +
    output.links +
    output.cruxes.length +
    output.hypotheses.length;
  const summary =
    object.summary ||
    (wrote > 0
      ? `Recorded ${wrote} contribution${wrote === 1 ? "" : "s"} for "${clip(ctx.brief, 60)}".`
      : `Nothing met the bar to record for "${clip(ctx.brief, 60)}".`);
  beats.push({ kind: "conclusion", nodeId: null, narration: summary });

  await appendRow(
    ctx.id,
    { status: "completed", phase: "done", summary, output, state },
    beats,
    priorSteps
  );
  return { delegationId: ctx.id, beats, done: true, summary };
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
