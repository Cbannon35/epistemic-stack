import "server-only";
import { createDb, schema } from "@epistack/db";
import { desc, eq } from "drizzle-orm";

// Persistence for investigations (= eve sessions): create/list for the sidebar,
// and save the session snapshot for resume.
const db = createDb();

export async function upsertInvestigation(input: {
  id: string;
  contributorId: string;
  title: string;
}): Promise<void> {
  await db
    .insert(schema.investigations)
    .values({
      id: input.id,
      contributorId: input.contributorId,
      title: input.title,
    })
    // Keep the original title/timestamp; only session snapshots update after.
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

export type InvestigationListItem = { id: string; title: string };

export function listInvestigations(
  contributorId: string
): Promise<InvestigationListItem[]> {
  return db
    .select({
      id: schema.investigations.id,
      title: schema.investigations.title,
    })
    .from(schema.investigations)
    .where(eq(schema.investigations.contributorId, contributorId))
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
