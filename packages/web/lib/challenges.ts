import "server-only";
import { createHash } from "node:crypto";
import { createDb, schema } from "@epistack/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type {
  ChallengeEntry,
  ChallengeTargetKind,
  ChallengeThread,
  ChallengeType,
  NodeChallengeSummary,
  NodeReceipts,
  ReceiptRecord,
} from "@/lib/challenge-types";

// Challenges + receipts over the commons. Challenges are `assessments` with
// kind = 'challenge' — the schema reserved this — so every dispute carries a
// `contribution` receipt and feeds the same late-binding trust layer as
// endorsements and credences. Nothing here mutates or deletes: a node's
// contested/answered state is derived at read time.

const db = createDb();

const contentHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 32);

async function recordUserContribution(input: {
  contributorId: string;
  method: string;
  payload: string;
  sessionId?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(schema.contributions)
    .values({
      contributorId: input.contributorId,
      method: input.method,
      payloadHash: contentHash(input.payload),
      sessionId: input.sessionId ?? undefined,
    })
    .returning({ id: schema.contributions.id });
  return row.id;
}

export type ChallengeTarget = { kind: ChallengeTargetKind; id: string };

const targetColumns = (target: ChallengeTarget) => ({
  claimId: target.kind === "claim" ? target.id : null,
  sourceId: target.kind === "source" ? target.id : null,
  hypothesisId: target.kind === "hypothesis" ? target.id : null,
  relationId: target.kind === "relation" ? target.id : null,
});

// Graph node ids ↔ challenge targets. Hypotheses/cruxes wear a prefix; claims
// and sources are both bare content hashes, so those need a lookup.
export async function resolveNodeTarget(
  nodeId: string
): Promise<ChallengeTarget | null> {
  if (nodeId.startsWith("hyp:")) {
    return { kind: "hypothesis", id: nodeId.slice(4) };
  }
  if (nodeId.startsWith("rel:")) {
    return { kind: "relation", id: nodeId.slice(4) };
  }
  if (nodeId.startsWith("crux:")) {
    return null; // cruxes are open questions — nothing asserted to dispute
  }
  const [claim] = await db
    .select({ id: schema.claims.canonicalId })
    .from(schema.claims)
    .where(eq(schema.claims.canonicalId, nodeId))
    .limit(1);
  if (claim) {
    return { kind: "claim", id: nodeId };
  }
  const [source] = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(eq(schema.sources.id, nodeId))
    .limit(1);
  return source ? { kind: "source", id: nodeId } : null;
}

export async function fileChallenge(input: {
  contributorId: string;
  target: ChallengeTarget;
  challengeType: ChallengeType;
  body: string;
  evidenceUrl?: string | null;
  sessionId?: string | null;
  method?: string;
}): Promise<string> {
  const contributionId = await recordUserContribution({
    contributorId: input.contributorId,
    method: input.method ?? "challenge@1",
    payload: input.body,
    sessionId: input.sessionId,
  });
  const [row] = await db
    .insert(schema.assessments)
    .values({
      assessorId: input.contributorId,
      kind: "challenge",
      ...targetColumns(input.target),
      challengeType: input.challengeType,
      evidenceUrl: input.evidenceUrl ?? null,
      rationale: input.body,
      method: input.method ?? "challenge@1",
      contributionId,
    })
    .returning({ id: schema.assessments.id });
  return row.id;
}

// A response joins the dispute record under the challenge it answers — same
// target, same append-only spine. It never closes anything; it just makes the
// derived state 'answered' once someone other than the challenger has spoken.
export async function respondToChallenge(input: {
  contributorId: string;
  challengeId: string;
  body: string;
  evidenceUrl?: string | null;
  sessionId?: string | null;
}): Promise<string | null> {
  const [challenge] = await db
    .select()
    .from(schema.assessments)
    .where(eq(schema.assessments.id, input.challengeId))
    .limit(1);
  // Must be a ROOT challenge — responses thread one level deep, so replying
  // to a response would orphan the row out of every derived view.
  if (challenge?.kind !== "challenge" || challenge.respondsTo !== null) {
    return null;
  }
  const contributionId = await recordUserContribution({
    contributorId: input.contributorId,
    method: "challenge_response@1",
    payload: input.body,
    sessionId: input.sessionId,
  });
  const [row] = await db
    .insert(schema.assessments)
    .values({
      assessorId: input.contributorId,
      kind: "challenge",
      claimId: challenge.claimId,
      sourceId: challenge.sourceId,
      hypothesisId: challenge.hypothesisId,
      relationId: challenge.relationId,
      evidenceUrl: input.evidenceUrl ?? null,
      respondsTo: input.challengeId,
      rationale: input.body,
      method: "challenge_response@1",
      contributionId,
    })
    .returning({ id: schema.assessments.id });
  return row.id;
}

type ChallengeRow = {
  id: string;
  assessorId: string;
  assessorName: string;
  assessorKind: string;
  claimId: string | null;
  sourceId: string | null;
  hypothesisId: string | null;
  relationId: string | null;
  challengeType: string | null;
  evidenceUrl: string | null;
  respondsTo: string | null;
  rationale: string | null;
  createdAt: Date;
};

function selectChallengeRows() {
  return db
    .select({
      id: schema.assessments.id,
      assessorId: schema.assessments.assessorId,
      assessorName: schema.contributors.displayName,
      assessorKind: schema.contributors.kind,
      claimId: schema.assessments.claimId,
      sourceId: schema.assessments.sourceId,
      hypothesisId: schema.assessments.hypothesisId,
      relationId: schema.assessments.relationId,
      challengeType: schema.assessments.challengeType,
      evidenceUrl: schema.assessments.evidenceUrl,
      respondsTo: schema.assessments.respondsTo,
      rationale: schema.assessments.rationale,
      createdAt: schema.contributions.createdAt,
    })
    .from(schema.assessments)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.assessments.assessorId)
    )
    .innerJoin(
      schema.contributions,
      eq(schema.contributions.id, schema.assessments.contributionId)
    );
}

const toEntry = (row: ChallengeRow): ChallengeEntry => ({
  id: row.id,
  authorId: row.assessorId,
  authorName: row.assessorName,
  authorKind: row.assessorKind,
  challengeType: (row.challengeType as ChallengeType | null) ?? null,
  body: row.rationale ?? "",
  evidenceUrl: row.evidenceUrl,
  createdAt: row.createdAt.toISOString(),
});

function buildThreads(rows: ChallengeRow[]): ChallengeThread[] {
  const roots = rows.filter((r) => r.respondsTo === null);
  return roots.map((root) => ({
    challenge: toEntry(root),
    responses: rows.filter((r) => r.respondsTo === root.id).map(toEntry),
  }));
}

/** A challenge is open until someone OTHER than its author responds. */
const isAnswered = (thread: ChallengeThread): boolean =>
  thread.responses.some(
    (response) => response.authorId !== thread.challenge.authorId
  );

export async function challengeThreadsFor(
  target: ChallengeTarget
): Promise<ChallengeThread[]> {
  const column = {
    claim: schema.assessments.claimId,
    source: schema.assessments.sourceId,
    hypothesis: schema.assessments.hypothesisId,
    relation: schema.assessments.relationId,
  }[target.kind];
  const rows = await selectChallengeRows()
    .where(and(eq(schema.assessments.kind, "challenge"), eq(column, target.id)))
    .orderBy(asc(schema.contributions.createdAt));
  return buildThreads(rows);
}

// Bulk rollup keyed by GRAPH NODE ID (claims/sources bare, hyp:/rel: prefixed)
// — one query feeds every badge in the graph and the chat transcript.
export async function challengeSummaryByNode(): Promise<
  Record<string, NodeChallengeSummary>
> {
  const rows = await selectChallengeRows()
    .where(eq(schema.assessments.kind, "challenge"))
    .orderBy(asc(schema.contributions.createdAt));
  const nodeIdOf = (row: ChallengeRow): string | null => {
    if (row.claimId) {
      return row.claimId;
    }
    if (row.sourceId) {
      return row.sourceId;
    }
    if (row.hypothesisId) {
      return `hyp:${row.hypothesisId}`;
    }
    if (row.relationId) {
      return `rel:${row.relationId}`;
    }
    return null;
  };
  const byNode = new Map<string, ChallengeRow[]>();
  for (const row of rows) {
    const nodeId = nodeIdOf(row);
    if (!nodeId) {
      continue;
    }
    const list = byNode.get(nodeId) ?? [];
    list.push(row);
    byNode.set(nodeId, list);
  }
  const summary: Record<string, NodeChallengeSummary> = {};
  for (const [nodeId, nodeRows] of byNode) {
    const threads = buildThreads(nodeRows);
    if (threads.length === 0) {
      continue;
    }
    const open = threads.filter((t) => !isAnswered(t)).length;
    summary[nodeId] = {
      open,
      total: threads.length,
      entries: nodeRows.length,
      state: open > 0 ? "contested" : "answered",
    };
  }
  return summary;
}

// ── receipts ─────────────────────────────────────────────────────────────────

type ContributionRow = {
  id: string;
  method: string;
  payloadHash: string;
  signature: string | null;
  sessionId: string | null;
  turnId: string | null;
  createdAt: Date;
  contributorId: string;
  contributorName: string;
  contributorKind: string;
};

// Resolve full receipt records (contributor, investigation, turn author) for
// a set of contribution ids in three bulk queries.
async function loadReceipts(
  contributionIds: string[]
): Promise<Map<string, ReceiptRecord>> {
  if (contributionIds.length === 0) {
    return new Map();
  }
  const rows: ContributionRow[] = await db
    .select({
      id: schema.contributions.id,
      method: schema.contributions.method,
      payloadHash: schema.contributions.payloadHash,
      signature: schema.contributions.signature,
      sessionId: schema.contributions.sessionId,
      turnId: schema.contributions.turnId,
      createdAt: schema.contributions.createdAt,
      contributorId: schema.contributors.id,
      contributorName: schema.contributors.displayName,
      contributorKind: schema.contributors.kind,
    })
    .from(schema.contributions)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.contributions.contributorId)
    )
    .where(inArray(schema.contributions.id, contributionIds));

  const sessionIds = [
    ...new Set(rows.map((r) => r.sessionId).filter((s): s is string => !!s)),
  ];
  const investigations =
    sessionIds.length > 0
      ? await db
          .select({
            id: schema.investigations.id,
            title: schema.investigations.title,
          })
          .from(schema.investigations)
          .where(inArray(schema.investigations.id, sessionIds))
      : [];
  const investigationById = new Map(investigations.map((i) => [i.id, i]));

  const turnIds = [
    ...new Set(rows.map((r) => r.turnId).filter((t): t is string => !!t)),
  ];
  const turnAuthors =
    turnIds.length > 0
      ? await db
          .select({
            sessionId: schema.investigationTurns.sessionId,
            turnId: schema.investigationTurns.turnId,
            displayName: schema.contributors.displayName,
          })
          .from(schema.investigationTurns)
          .innerJoin(
            schema.contributors,
            eq(schema.contributors.id, schema.investigationTurns.contributorId)
          )
          .where(inArray(schema.investigationTurns.turnId, turnIds))
      : [];
  const authorByTurn = new Map(
    turnAuthors.map((t) => [`${t.sessionId}:${t.turnId}`, t.displayName])
  );

  const receipts = new Map<string, ReceiptRecord>();
  for (const row of rows) {
    const investigation = row.sessionId
      ? (investigationById.get(row.sessionId) ?? null)
      : null;
    receipts.set(row.id, {
      contributionId: row.id,
      method: row.method,
      payloadHash: row.payloadHash,
      signed: row.signature !== null,
      createdAt: row.createdAt.toISOString(),
      contributor: {
        id: row.contributorId,
        name: row.contributorName,
        kind: row.contributorKind,
      },
      investigation: investigation
        ? { id: investigation.id, title: investigation.title }
        : null,
      askedBy:
        row.sessionId && row.turnId
          ? (authorByTurn.get(`${row.sessionId}:${row.turnId}`) ?? null)
          : null,
    });
  }
  return receipts;
}

// The chain of custody for one graph node: who created it, in which
// investigation, during whose turn, from which sources — plus its full
// challenge history and derived dispute state.
export async function getNodeReceipts(
  nodeId: string
): Promise<NodeReceipts | null> {
  if (nodeId.startsWith("crux:")) {
    const [crux] = await db
      .select()
      .from(schema.cruxes)
      .where(eq(schema.cruxes.id, nodeId.slice(5)))
      .limit(1);
    if (!crux) {
      return null;
    }
    const receipts = await loadReceipts([crux.contributionId]);
    return {
      nodeId,
      kind: "crux",
      label: crux.question,
      created: receipts.get(crux.contributionId) ?? null,
      mentions: [],
      threads: [],
      state: "undisputed",
    };
  }

  if (nodeId.startsWith("hyp:")) {
    const [hypothesis] = await db
      .select()
      .from(schema.hypotheses)
      .where(eq(schema.hypotheses.id, nodeId.slice(4)))
      .limit(1);
    if (!hypothesis) {
      return null;
    }
    const [receipts, threads] = await Promise.all([
      loadReceipts([hypothesis.contributionId]),
      challengeThreadsFor({ kind: "hypothesis", id: hypothesis.id }),
    ]);
    return {
      nodeId,
      kind: "hypothesis",
      label: hypothesis.statement,
      created: receipts.get(hypothesis.contributionId) ?? null,
      mentions: [],
      threads,
      state: stateOf(threads),
    };
  }

  const [claim] = await db
    .select({
      canonicalId: schema.claims.canonicalId,
      text: schema.claims.text,
      contributionId: schema.claims.contributionId,
    })
    .from(schema.claims)
    .where(eq(schema.claims.canonicalId, nodeId))
    .limit(1);
  if (claim) {
    const mentions = await db
      .select()
      .from(schema.mentions)
      .where(eq(schema.mentions.claimId, claim.canonicalId));
    const sourceIds = [...new Set(mentions.map((m) => m.sourceId))];
    const [sources, receipts, threads] = await Promise.all([
      sourceIds.length > 0
        ? db
            .select({
              id: schema.sources.id,
              title: schema.sources.title,
              url: schema.sources.url,
            })
            .from(schema.sources)
            .where(inArray(schema.sources.id, sourceIds))
        : Promise.resolve([]),
      loadReceipts([
        claim.contributionId,
        ...mentions.map((m) => m.contributionId),
      ]),
      challengeThreadsFor({ kind: "claim", id: claim.canonicalId }),
    ]);
    const sourceById = new Map(sources.map((s) => [s.id, s]));
    return {
      nodeId,
      kind: "claim",
      label: claim.text,
      created: receipts.get(claim.contributionId) ?? null,
      mentions: mentions.map((m) => ({
        quote: m.quote,
        sourceId: m.sourceId,
        sourceTitle: sourceById.get(m.sourceId)?.title ?? null,
        sourceUrl: sourceById.get(m.sourceId)?.url ?? null,
        receipt: receipts.get(m.contributionId) ?? null,
      })),
      threads,
      state: stateOf(threads),
    };
  }

  const [source] = await db
    .select({
      id: schema.sources.id,
      title: schema.sources.title,
      url: schema.sources.url,
      contributionId: schema.sources.contributionId,
    })
    .from(schema.sources)
    .where(eq(schema.sources.id, nodeId))
    .limit(1);
  if (source) {
    const [receipts, threads] = await Promise.all([
      loadReceipts([source.contributionId]),
      challengeThreadsFor({ kind: "source", id: source.id }),
    ]);
    return {
      nodeId,
      kind: "source",
      label: source.title ?? source.url ?? "source",
      created: receipts.get(source.contributionId) ?? null,
      mentions: [],
      threads,
      state: stateOf(threads),
    };
  }

  return null;
}

const stateOf = (
  threads: ChallengeThread[]
): "undisputed" | "contested" | "answered" => {
  if (threads.length === 0) {
    return "undisputed";
  }
  return threads.some((t) => !isAnswered(t)) ? "contested" : "answered";
};

// ── comment → challenge promotion ────────────────────────────────────────────

// Seed a challenge from a public comment thread: the quote + every entry
// become the dispute body, and the thread's discussion survives as a commons
// receipt instead of staying app-side.
export async function commentThreadSeed(
  commentId: string
): Promise<{ body: string; visibility: string } | null> {
  const [root] = await db
    .select({
      id: schema.comments.id,
      body: schema.comments.body,
      quote: schema.comments.quote,
      visibility: schema.comments.visibility,
      authorName: schema.contributors.displayName,
    })
    .from(schema.comments)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.comments.authorId)
    )
    .where(
      and(eq(schema.comments.id, commentId), isNull(schema.comments.parentId))
    )
    .limit(1);
  if (!root) {
    return null;
  }
  const replies = await db
    .select({
      body: schema.comments.body,
      authorName: schema.contributors.displayName,
    })
    .from(schema.comments)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.comments.authorId)
    )
    .where(eq(schema.comments.parentId, commentId))
    .orderBy(asc(schema.comments.createdAt));
  const lines = [
    root.quote ? `On the passage "${root.quote.slice(0, 300)}":` : null,
    `${root.authorName.split("@")[0]}: ${root.body}`,
    ...replies.map((r) => `${r.authorName.split("@")[0]}: ${r.body}`),
  ].filter(Boolean);
  return {
    body: `Promoted from a transcript comment thread.\n${lines.join("\n")}`.slice(
      0,
      4000
    ),
    visibility: root.visibility,
  };
}
