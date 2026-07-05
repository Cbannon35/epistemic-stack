"use server";

import { createDb, schema } from "@epistack/db";
import { and, count, eq, gt, inArray, or, type SQL } from "drizzle-orm";
import { getAncestorChain } from "@/lib/investigations";
import { createClient } from "@/lib/supabase/server";

// The catch-up digest: what happened in this room while the viewer was away.
// One action, one Promise.all of count queries — the client calls it at most
// once per room visit (and only after a meaningful absence).

const db = createDb();

export type RoomDigest = {
  /** Questions asked in THIS room (turn authorship rows). */
  turns: number;
  /** Commons growth across the room's fork lineage. */
  claims: number;
  sources: number;
  relations: number;
  cruxes: number;
  hypotheses: number;
  /** Dispute entries (challenges + responses) on lineage contributions. */
  disputes: number;
  /** Credences recorded on lineage contributions. */
  credences: number;
  /** Comment activity visible to the viewer. */
  comments: number;
  /** Delegated investigations that finished. */
  delegationsCompleted: number;
};

export async function getRoomDigest(input: {
  sessionId: string;
  /** Epoch ms of the viewer's last visit. */
  since: number;
}): Promise<RoomDigest | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(user && input.sessionId && Number.isFinite(input.since))) {
    return null;
  }
  const since = new Date(input.since);
  const lineage = await getAncestorChain(input.sessionId);
  if (lineage.length === 0) {
    return null;
  }
  // Fresh condition per query — drizzle builders shouldn't share instances.
  const grewSince = (): SQL | undefined =>
    and(
      inArray(schema.contributions.sessionId, lineage),
      gt(schema.contributions.createdAt, since)
    );

  const [
    turns,
    claims,
    sources,
    relations,
    cruxes,
    hypotheses,
    disputes,
    credences,
    comments,
    delegationsCompleted,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.investigationTurns)
      .where(
        and(
          eq(schema.investigationTurns.sessionId, input.sessionId),
          gt(schema.investigationTurns.createdAt, since)
        )
      ),
    db
      .select({ n: count() })
      .from(schema.claims)
      .innerJoin(
        schema.contributions,
        eq(schema.contributions.id, schema.claims.contributionId)
      )
      .where(grewSince()),
    db
      .select({ n: count() })
      .from(schema.sources)
      .innerJoin(
        schema.contributions,
        eq(schema.contributions.id, schema.sources.contributionId)
      )
      .where(grewSince()),
    db
      .select({ n: count() })
      .from(schema.relations)
      .innerJoin(
        schema.contributions,
        eq(schema.contributions.id, schema.relations.contributionId)
      )
      .where(grewSince()),
    db
      .select({ n: count() })
      .from(schema.cruxes)
      .innerJoin(
        schema.contributions,
        eq(schema.contributions.id, schema.cruxes.contributionId)
      )
      .where(grewSince()),
    db
      .select({ n: count() })
      .from(schema.hypotheses)
      .innerJoin(
        schema.contributions,
        eq(schema.contributions.id, schema.hypotheses.contributionId)
      )
      .where(grewSince()),
    db
      .select({ n: count() })
      .from(schema.assessments)
      .innerJoin(
        schema.contributions,
        eq(schema.contributions.id, schema.assessments.contributionId)
      )
      .where(and(eq(schema.assessments.kind, "challenge"), grewSince())),
    db
      .select({ n: count() })
      .from(schema.assessments)
      .innerJoin(
        schema.contributions,
        eq(schema.contributions.id, schema.assessments.contributionId)
      )
      .where(and(eq(schema.assessments.kind, "credence"), grewSince())),
    db
      .select({ n: count() })
      .from(schema.comments)
      .where(
        and(
          eq(schema.comments.sessionId, input.sessionId),
          gt(schema.comments.createdAt, since),
          or(
            eq(schema.comments.visibility, "public"),
            eq(schema.comments.authorId, user.id)
          )
        )
      ),
    db
      .select({ n: count() })
      .from(schema.delegations)
      .where(
        and(
          eq(schema.delegations.sessionId, input.sessionId),
          eq(schema.delegations.status, "completed"),
          gt(schema.delegations.updatedAt, since)
        )
      ),
  ]);

  return {
    turns: turns[0]?.n ?? 0,
    claims: claims[0]?.n ?? 0,
    sources: sources[0]?.n ?? 0,
    relations: relations[0]?.n ?? 0,
    cruxes: cruxes[0]?.n ?? 0,
    hypotheses: hypotheses[0]?.n ?? 0,
    disputes: disputes[0]?.n ?? 0,
    credences: credences[0]?.n ?? 0,
    comments: comments[0]?.n ?? 0,
    delegationsCompleted: delegationsCompleted[0]?.n ?? 0,
  };
}
