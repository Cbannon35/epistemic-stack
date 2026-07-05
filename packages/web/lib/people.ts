import "server-only";
import { createDb, schema } from "@epistack/db";
import { and, asc, count, eq, inArray, max } from "drizzle-orm";

// Read-side queries behind the person card: a contributor's footprint in the
// commons, and the credence-by-credence comparison of two people's beliefs.

const db = createDb();

export type ContributorStats = {
  contributions: number;
  lastAt: string | null;
};

export async function getContributorStats(
  contributorId: string
): Promise<ContributorStats> {
  const [row] = await db
    .select({
      contributions: count(),
      lastAt: max(schema.contributions.createdAt),
    })
    .from(schema.contributions)
    .where(eq(schema.contributions.contributorId, contributorId));
  return {
    contributions: row?.contributions ?? 0,
    lastAt: row?.lastAt?.toISOString() ?? null,
  };
}

export type BeliefGap = {
  hypothesisId: string;
  statement: string;
  /** Latest credences 0..1 — "mine" is the viewer's. */
  mine: number;
  theirs: number;
  gap: number;
};

export type BeliefComparison = {
  rows: BeliefGap[];
  /** Hypotheses only the viewer has rated. */
  onlyMine: number;
  /** Hypotheses only the other person has rated. */
  onlyTheirs: number;
};

// Latest credence per (hypothesis, assessor) for the two people, then rank
// the shared hypotheses by |gap| — the widest gap is where to talk first.
export async function compareBeliefs(
  viewerId: string,
  otherId: string
): Promise<BeliefComparison> {
  const rows = await db
    .select({
      hypothesisId: schema.assessments.hypothesisId,
      assessorId: schema.assessments.assessorId,
      value: schema.assessments.credence,
      statement: schema.hypotheses.statement,
      createdAt: schema.contributions.createdAt,
    })
    .from(schema.assessments)
    .innerJoin(
      schema.hypotheses,
      eq(schema.hypotheses.id, schema.assessments.hypothesisId)
    )
    .innerJoin(
      schema.contributions,
      eq(schema.contributions.id, schema.assessments.contributionId)
    )
    .where(
      and(
        eq(schema.assessments.kind, "credence"),
        inArray(schema.assessments.assessorId, [viewerId, otherId])
      )
    )
    .orderBy(asc(schema.contributions.createdAt));

  // Append-only history — the last row per (hypothesis, assessor) wins.
  const latest = new Map<
    string,
    { statement: string; mine?: number; theirs?: number }
  >();
  for (const row of rows) {
    if (row.hypothesisId == null || row.value == null) {
      continue;
    }
    const entry = latest.get(row.hypothesisId) ?? { statement: row.statement };
    if (row.assessorId === viewerId) {
      entry.mine = row.value;
    } else {
      entry.theirs = row.value;
    }
    latest.set(row.hypothesisId, entry);
  }

  const shared: BeliefGap[] = [];
  let onlyMine = 0;
  let onlyTheirs = 0;
  for (const [hypothesisId, entry] of latest) {
    if (entry.mine !== undefined && entry.theirs !== undefined) {
      shared.push({
        hypothesisId,
        statement: entry.statement,
        mine: entry.mine,
        theirs: entry.theirs,
        gap: Math.abs(entry.mine - entry.theirs),
      });
    } else if (entry.mine === undefined) {
      onlyTheirs += 1;
    } else {
      onlyMine += 1;
    }
  }
  shared.sort((a, b) => b.gap - a.gap);
  return { rows: shared, onlyMine, onlyTheirs };
}
