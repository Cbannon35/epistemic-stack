import "server-only";
import { createDb, schema } from "@epistack/db";

// Ensure a commons `contributor` row exists for a signed-in Supabase user,
// keyed by the user's id so every contribution is attributable to them — the
// receipts spine that makes the commons auditable.
export async function ensureContributor(id: string, displayName: string) {
  const db = createDb();
  await db
    .insert(schema.contributors)
    .values({ id, kind: "human", displayName })
    .onConflictDoNothing();
}
