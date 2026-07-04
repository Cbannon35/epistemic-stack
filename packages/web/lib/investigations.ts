import "server-only";
import { createDb, schema } from "@epistack/db";
import { desc, eq } from "drizzle-orm";

// Persistence for investigations (= eve sessions): shared rooms any signed-in
// user can list/open/join, plus per-turn author attribution and fork lineage.
const db = createDb();

export async function upsertInvestigation(input: {
  id: string;
  contributorId: string;
  title: string;
  forkedFrom?: string | null;
}): Promise<void> {
  await db
    .insert(schema.investigations)
    .values({
      id: input.id,
      contributorId: input.contributorId,
      title: input.title,
      forkedFrom: input.forkedFrom ?? null,
    })
    // Insert-only: title, owner, and lineage are set once by whoever created
    // the session; later saves only touch the snapshot columns.
    .onConflictDoNothing();
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

// Walk fork lineage root-ward: [id, parent, grandparent, …]. Iterative with a
// visited set so a (theoretically impossible) cycle can't hang the request.
export async function getAncestorChain(id: string): Promise<string[]> {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor && !seen.has(cursor) && chain.length < 32) {
    seen.add(cursor);
    chain.push(cursor);
    const [row]: Array<{ forkedFrom: string | null }> = await db
      .select({ forkedFrom: schema.investigations.forkedFrom })
      .from(schema.investigations)
      .where(eq(schema.investigations.id, cursor))
      .limit(1);
    cursor = row?.forkedFrom ?? null;
  }
  return chain;
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
