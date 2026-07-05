import { createHash } from "node:crypto";
import { createDb, schema } from "@epistack/db";
import { cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { embed } from "./embed.ts";

// Server-side commons access for the agent's tools. Every write is a
// `contribution` (a receipt) attributed to the agent contributor, and claims
// are deduped by embedding similarity — this is where "ten sources, one claim"
// and the append-only receipt trail become real.

const db = createDb();

// The AI research agent as a commons contributor (fixed id for attribution).
const AGENT_CONTRIBUTOR_ID = "00000000-0000-0000-0000-0000000000a1";

// Two claims are "the same" at/above this cosine similarity. Calibrated to
// gte-small (paraphrases ~0.94, unrelated ~0.72).
const DEDUP_THRESHOLD = 0.9;

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

let agentEnsured = false;
async function ensureAgentContributor() {
  if (agentEnsured) {
    return;
  }
  await db
    .insert(schema.contributors)
    .values({
      id: AGENT_CONTRIBUTOR_ID,
      kind: "agent",
      displayName: "eve-research-agent",
    })
    .onConflictDoNothing();
  agentEnsured = true;
}

async function recordContribution(
  method: string,
  payload: string,
  sessionId?: string,
  turnId?: string
): Promise<string> {
  await ensureAgentContributor();
  const [row] = await db
    .insert(schema.contributions)
    .values({
      contributorId: AGENT_CONTRIBUTOR_ID,
      method,
      payloadHash: contentHash(payload),
      sessionId,
      // The receipt that joins this write to the turn — and through
      // investigation_turns, to the human whose question produced it.
      turnId,
    })
    .returning({ id: schema.contributions.id });
  return row.id;
}

export type AddSourceInput = {
  text: string;
  stableId?: string;
  url?: string;
  title?: string;
  author?: string;
  publisher?: string;
  date?: string;
  guarantees?: Record<string, unknown>;
  retrieval?: Record<string, unknown>;
  sessionId?: string;
  turnId?: string;
};

// Content-addressed source: the id is a hash of the stored text, so the same
// artifact fetched twice resolves to one row.
export async function addSource(input: AddSourceInput): Promise<string> {
  const id = contentHash(input.text);
  const contributionId = await recordContribution(
    "fetch_source@1",
    input.text,
    input.sessionId,
    input.turnId
  );
  await db
    .insert(schema.sources)
    .values({
      id,
      stableId: input.stableId,
      url: input.url,
      title: input.title,
      author: input.author,
      publisher: input.publisher,
      publishedDate: input.date,
      guarantees: input.guarantees,
      retrieval: input.retrieval,
      contributionId,
    })
    .onConflictDoNothing();
  return id;
}

async function nearestClaim(vec: number[]) {
  const similarity = sql<number>`1 - (${cosineDistance(schema.claims.embedding, vec)})`;
  const rows = await db
    .select({
      id: schema.claims.canonicalId,
      text: schema.claims.text,
      similarity,
    })
    .from(schema.claims)
    .orderBy(desc(similarity))
    .limit(1);
  return rows[0] ?? null;
}

export type RecordClaimInput = {
  text: string;
  sourceId: string;
  quote: string;
  spanStart?: number;
  spanEnd?: number;
  descriptors?: Record<string, unknown>;
  sessionId?: string;
  turnId?: string;
};

export type RecordClaimResult = {
  canonicalId: string;
  isNew: boolean;
  mergedSimilarity: number | null;
};

// Embed the claim, find the nearest existing claim; if it clears the dedup
// threshold the new mention attaches to that canonical claim (a re-find that
// powers coverage/compounding), otherwise a new claim node is created. Either
// way a mention records the verbatim source span (the receipt that the source
// actually says it).
export async function recordClaim(
  input: RecordClaimInput
): Promise<RecordClaimResult> {
  const normalized = input.text.trim().replace(/\s+/g, " ");
  const vec = await embed(normalized);
  const near = await nearestClaim(vec);

  let canonicalId: string;
  let isNew = false;
  let mergedSimilarity: number | null = null;

  if (near && near.similarity >= DEDUP_THRESHOLD) {
    canonicalId = near.id;
    mergedSimilarity = near.similarity;
  } else {
    canonicalId = contentHash(normalized);
    const contributionId = await recordContribution(
      "record_claim@1",
      normalized,
      input.sessionId,
      input.turnId
    );
    await db
      .insert(schema.claims)
      .values({
        canonicalId,
        text: input.text,
        normalizedText: normalized,
        embedding: vec,
        descriptors: input.descriptors,
        contributionId,
      })
      .onConflictDoNothing();
    isNew = true;
  }

  const mentionContribution = await recordContribution(
    "record_claim@1",
    input.quote,
    input.sessionId,
    input.turnId
  );
  await db.insert(schema.mentions).values({
    claimId: canonicalId,
    sourceId: input.sourceId,
    quote: input.quote,
    spanStart: input.spanStart,
    spanEnd: input.spanEnd,
    contributionId: mentionContribution,
  });

  return { canonicalId, isNew, mergedSimilarity };
}

export type ClaimMatch = {
  id: string;
  text: string;
  similarity: number;
};

// Semantic search over existing claims — lets the agent build on prior work
// (compounding) and see what's already known before re-extracting.
export async function queryClaims(
  queryText: string,
  limit = 8
): Promise<ClaimMatch[]> {
  const vec = await embed(queryText);
  const similarity = sql<number>`1 - (${cosineDistance(schema.claims.embedding, vec)})`;
  return db
    .select({
      id: schema.claims.canonicalId,
      text: schema.claims.text,
      similarity,
    })
    .from(schema.claims)
    .orderBy(desc(similarity))
    .limit(limit);
}

// ── structure ────────────────────────────────────────────────────────────────

export type RelationType =
  | "supports"
  | "contradicts"
  | "depends_on"
  | "refines";

// A typed, challengeable edge between two existing claims (itself a receipt).
export async function recordRelation(input: {
  fromClaimId: string;
  toClaimId: string;
  type: RelationType;
  rationale?: string;
  sessionId?: string;
  turnId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Validate both endpoints exist so a bad claim id returns graceful feedback
  // to the model instead of a foreign-key crash.
  const rows = await db
    .select({ id: schema.claims.canonicalId })
    .from(schema.claims)
    .where(
      inArray(schema.claims.canonicalId, [input.fromClaimId, input.toClaimId])
    );
  const found = new Set(rows.map((r) => r.id));
  const missing = [input.fromClaimId, input.toClaimId].filter(
    (id) => !found.has(id)
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `claim id(s) not found: ${missing.join(", ")}. Use ids returned by record_claim or query_commons.`,
    };
  }
  const contributionId = await recordContribution(
    "record_relation@1",
    input.fromClaimId + input.type + input.toClaimId,
    input.sessionId,
    input.turnId
  );
  await db.insert(schema.relations).values({
    fromClaimId: input.fromClaimId,
    toClaimId: input.toClaimId,
    type: input.type,
    rationale: input.rationale,
    contributionId,
  });
  return { ok: true };
}

// An open "what would change our mind" question tied to a claim.
export async function recordCrux(input: {
  claimId: string;
  question: string;
  implication?: string;
  sessionId?: string;
  turnId?: string;
}): Promise<{ ok: boolean; error?: string; cruxId?: string }> {
  const rows = await db
    .select({ id: schema.claims.canonicalId })
    .from(schema.claims)
    .where(eq(schema.claims.canonicalId, input.claimId));
  if (rows.length === 0) {
    return {
      ok: false,
      error: `claim id not found: ${input.claimId}. Use an id returned by record_claim or query_commons.`,
    };
  }
  const contributionId = await recordContribution(
    "record_crux@1",
    input.question,
    input.sessionId,
    input.turnId
  );
  const [inserted] = await db
    .insert(schema.cruxes)
    .values({
      claimId: input.claimId,
      question: input.question,
      implication: input.implication,
      status: "open",
      contributionId,
    })
    .returning({ id: schema.cruxes.id });
  return { ok: true, cruxId: inserted?.id };
}

// A competing explanation for the question (e.g. "lab leak" vs "zoonotic").
export async function recordHypothesis(input: {
  statement: string;
  answerBearing?: string;
  sessionId?: string;
  turnId?: string;
}): Promise<{ id: string }> {
  const contributionId = await recordContribution(
    "record_hypothesis@1",
    input.statement,
    input.sessionId,
    input.turnId
  );
  const [row] = await db
    .insert(schema.hypotheses)
    .values({
      statement: input.statement,
      answerBearing: input.answerBearing,
      sessionId: input.sessionId,
      contributionId,
    })
    .returning({ id: schema.hypotheses.id });
  return { id: row.id };
}

// Attach a claim to a hypothesis with a polarity + diagnosticity (how much it
// discriminates the hypothesis from its rivals).
export async function linkClaimToHypothesis(input: {
  claimId: string;
  hypothesisId: string;
  polarity: "supports" | "undermines";
  diagnosticity?: number;
  sessionId?: string;
  turnId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const claim = await db
    .select({ id: schema.claims.canonicalId })
    .from(schema.claims)
    .where(eq(schema.claims.canonicalId, input.claimId));
  if (claim.length === 0) {
    return { ok: false, error: `claim id not found: ${input.claimId}` };
  }
  const hyp = await db
    .select({ id: schema.hypotheses.id })
    .from(schema.hypotheses)
    .where(eq(schema.hypotheses.id, input.hypothesisId));
  if (hyp.length === 0) {
    return {
      ok: false,
      error: `hypothesis id not found: ${input.hypothesisId}`,
    };
  }
  const contributionId = await recordContribution(
    "link_hypothesis@1",
    input.claimId + input.hypothesisId,
    input.sessionId,
    input.turnId
  );
  await db.insert(schema.hypothesisLinks).values({
    hypothesisId: input.hypothesisId,
    claimId: input.claimId,
    polarity: input.polarity,
    diagnosticity: input.diagnosticity,
    contributionId,
  });
  return { ok: true };
}
