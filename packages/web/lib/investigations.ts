import "server-only";
import { createDb, schema } from "@epistack/db";
import { and, desc, eq, isNull, or } from "drizzle-orm";

// Persistence for investigations (= eve sessions): shared rooms any signed-in
// user can list/open/join, plus per-turn author attribution and fork lineage.
const db = createDb();

export async function upsertInvestigation(input: {
  id: string;
  contributorId: string;
  title: string;
  forkedFrom?: string | null;
  eveSessionId?: string | null;
  seedFromCommons?: boolean;
}): Promise<void> {
  await db
    .insert(schema.investigations)
    .values({
      id: input.id,
      contributorId: input.contributorId,
      title: input.title,
      forkedFrom: input.forkedFrom ?? null,
      eveSessionId: input.eveSessionId ?? null,
      seedFromCommons: input.seedFromCommons ?? true,
    })
    // Insert-only: title, owner, and lineage are set once by whoever created
    // the session; later saves only touch the snapshot columns. Fork rows
    // already exist at first send, so this is a no-op for them.
    .onConflictDoNothing();
}

/**
 * Bind a fork row to the eve session created by its FIRST sender. Conditional
 * on the slot being empty so two members racing the first send can't split the
 * room across two eve sessions — the loser's write is dropped and their next
 * send resumes the winner's session via getSendState.
 */
export async function claimEveSession(input: {
  id: string;
  eveSessionId: string;
  sessionState: unknown;
  events: unknown;
}): Promise<boolean> {
  const claimed = await db
    .update(schema.investigations)
    .set({
      eveSessionId: input.eveSessionId,
      sessionState: input.sessionState,
      events: input.events,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.investigations.id, input.id),
        or(
          isNull(schema.investigations.eveSessionId),
          // Idempotent for the winner (and for legacy rows inserted with
          // their eve id already set) — only a DIFFERENT session is rejected.
          eq(schema.investigations.eveSessionId, input.eveSessionId)
        )
      )
    )
    .returning({ id: schema.investigations.id });
  return claimed.length > 0;
}

export async function saveInvestigationSession(input: {
  id: string;
  sessionState: unknown;
  events: unknown;
  updatedAt: Date;
}): Promise<void> {
  await db
    .update(schema.investigations)
    .set({
      sessionState: input.sessionState,
      events: input.events,
      updatedAt: input.updatedAt,
    })
    .where(eq(schema.investigations.id, input.id));
}

/** Owner-only retitle. Returns false when the row isn't the caller's. */
export async function renameInvestigation(input: {
  id: string;
  title: string;
  ownerId: string;
}): Promise<boolean> {
  const rows = await db
    .update(schema.investigations)
    .set({ title: input.title })
    .where(
      and(
        eq(schema.investigations.id, input.id),
        eq(schema.investigations.contributorId, input.ownerId)
      )
    )
    .returning({ id: schema.investigations.id });
  return rows.length > 0;
}

export type InvestigationListItem = {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  forkedFrom: string | null;
};

// The commons is shared: every signed-in user sees every investigation.
export function listInvestigations(): Promise<InvestigationListItem[]> {
  return db
    .select({
      id: schema.investigations.id,
      title: schema.investigations.title,
      ownerId: schema.investigations.contributorId,
      ownerName: schema.contributors.displayName,
      forkedFrom: schema.investigations.forkedFrom,
    })
    .from(schema.investigations)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.investigations.contributorId)
    )
    .orderBy(desc(schema.investigations.updatedAt))
    .limit(50);
}

export async function getInvestigation(id: string) {
  const [row] = await db
    .select()
    .from(schema.investigations)
    .where(eq(schema.investigations.id, id))
    .limit(1);
  return row ?? null;
}

// One hop of a fork lineage: the git-ref shape of an investigation's scope.
export type LineageHop = {
  /** Durable investigation row id (delegate-run writes carry this). */
  id: string;
  /** The eve session bound to the row (agent-turn writes carry this).
   * Null on legacy rows, where `id` IS the eve session id. */
  eveSessionId: string | null;
  /** Epoch-ms upper bound on this ancestor's contributions — the moment the
   * chain forked away from it. Null = unbounded (the leaf itself, and legacy
   * forks that predate fork cutoffs). */
  cutoff: number | null;
};

// Walk fork lineage root-ward: [self, parent, grandparent, …]. Each ancestor
// hop is bounded by the fork moment of its child-in-chain (transitively
// min-composed, so a fork of a fork can't see past its grandparent's cut).
// Iterative with a visited set so a (theoretically impossible) cycle can't
// hang the request.
export async function getAncestorChain(id: string): Promise<LineageHop[]> {
  const chain: LineageHop[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  let bound: number | null = null;
  while (cursor && !seen.has(cursor) && chain.length < 32) {
    seen.add(cursor);
    const [row] = await db
      .select({
        forkedFrom: schema.investigations.forkedFrom,
        eveSessionId: schema.investigations.eveSessionId,
        forkCutoff: schema.investigations.forkCutoff,
      })
      .from(schema.investigations)
      .where(eq(schema.investigations.id, cursor))
      .limit(1);
    chain.push({
      id: cursor,
      eveSessionId: row?.eveSessionId ?? null,
      cutoff: bound,
    });
    const forkedAt = row?.forkCutoff ? row.forkCutoff.getTime() : null;
    if (forkedAt != null) {
      bound = bound == null ? forkedAt : Math.min(bound, forkedAt);
    }
    cursor = row?.forkedFrom ?? null;
  }
  return chain;
}

/** Every session id a lineage hop's contributions may be keyed under. */
export function hopSessionIds(hop: LineageHop): string[] {
  return hop.eveSessionId && hop.eveSessionId !== hop.id
    ? [hop.id, hop.eveSessionId]
    : [hop.id];
}

export type TurnAuthor = {
  turnId: string;
  contributorId: string;
  displayName: string;
};

export function listTurnAuthors(sessionId: string): Promise<TurnAuthor[]> {
  return db
    .select({
      turnId: schema.investigationTurns.turnId,
      contributorId: schema.investigationTurns.contributorId,
      displayName: schema.contributors.displayName,
    })
    .from(schema.investigationTurns)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.investigationTurns.contributorId)
    )
    .where(eq(schema.investigationTurns.sessionId, sessionId));
}

export async function insertTurnAuthor(input: {
  sessionId: string;
  turnId: string;
  contributorId: string;
}): Promise<void> {
  await db
    .insert(schema.investigationTurns)
    .values(input)
    // Composite PK absorbs double-fires and concurrent-send edge cases.
    .onConflictDoNothing();
}
