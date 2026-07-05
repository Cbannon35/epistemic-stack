import "server-only";
import { createHash } from "node:crypto";
import { createDb, schema } from "@epistack/db";
import { desc, eq, isNotNull } from "drizzle-orm";
import type { LensDefinition, LensRule } from "./types";
import { rulesFromConfig } from "./types";

// Saved lenses. A lens is itself a receipted contribution — even your trust
// choices have provenance — so saving one writes the contribution row first.

const db = createDb();

export async function listSavedLenses(): Promise<LensDefinition[]> {
  const rows = await db
    .select({
      id: schema.lenses.id,
      name: schema.lenses.name,
      description: schema.lenses.description,
      config: schema.lenses.config,
      ownerId: schema.lenses.ownerId,
      ownerName: schema.contributors.displayName,
    })
    .from(schema.lenses)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.lenses.ownerId)
    )
    // Pre-lens-editor rows (no owner) used an undefined config shape; skip them.
    .where(isNotNull(schema.lenses.ownerId))
    .orderBy(desc(schema.lenses.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    rules: rulesFromConfig(row.config),
    ownerId: row.ownerId ?? undefined,
    ownerName: row.ownerName,
  }));
}

export async function insertLens(input: {
  ownerId: string;
  name: string;
  description: string | null;
  rules: LensRule[];
}): Promise<string> {
  const config = { rules: input.rules };
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex");
  const [contribution] = await db
    .insert(schema.contributions)
    .values({
      contributorId: input.ownerId,
      method: "lens-editor@1",
      payloadHash,
    })
    .returning({ id: schema.contributions.id });
  const [lens] = await db
    .insert(schema.lenses)
    .values({
      name: input.name,
      description: input.description,
      config,
      ownerId: input.ownerId,
      contributionId: contribution.id,
    })
    .returning({ id: schema.lenses.id });
  return lens.id;
}
