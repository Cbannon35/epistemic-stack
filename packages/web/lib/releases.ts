import "server-only";
import { createDb, schema } from "@epistack/db";
import { desc, eq } from "drizzle-orm";
import { contentHash } from "@/lib/content-hash";
import { buildGraphData, type GraphPayload } from "@/lib/graph-data";
import {
  getScopeHops,
  parseScopeHops,
  type ScopeHop,
} from "@/lib/investigations";
import type { ReleaseRecord } from "@/lib/release-types";

// Releases: named, citable checkpoints of an investigation's graph. Nothing
// is copied — a release is a RECIPE (materialized scope hops + an as-of
// moment), and immutability falls out of time-capping the append-only
// ledger: the same hops + the same cutoff always resolve to the same graph.
// The recipe survives room renames and fork deletion (title snapshot, no FK).

const db = createDb();

type ReleaseRow = typeof schema.releases.$inferSelect;

function toRecord(row: ReleaseRow, creatorName: string): ReleaseRecord {
  return {
    id: row.id,
    investigationId: row.investigationId,
    title: row.titleSnapshot,
    version: row.version,
    name: row.name,
    notes: row.notes,
    cutoff: row.cutoff.toISOString(),
    createdBy: row.createdBy,
    creatorName,
    createdAt: row.createdAt.toISOString(),
  };
}

export type CutReleaseResult = { release: ReleaseRecord } | { error: string };

// Any signed-in contributor may cut a release: it is a pure addition (no
// scope changes for anyone), the createdBy receipt carries accountability,
// and write-time gatekeeping is against the project's grain.
export async function cutRelease(input: {
  investigationId: string;
  userId: string;
  name?: string | null;
  notes?: string | null;
}): Promise<CutReleaseResult> {
  const [inv] = await db
    .select({ title: schema.investigations.title })
    .from(schema.investigations)
    .where(eq(schema.investigations.id, input.investigationId))
    .limit(1);
  if (!inv) {
    return { error: "that investigation no longer exists" };
  }
  const hops = await getScopeHops(input.investigationId);
  if (hops.length === 0) {
    return { error: "nothing to release yet" };
  }
  const cutoff = new Date();
  const release = await db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: schema.releases.version })
      .from(schema.releases)
      .where(eq(schema.releases.investigationId, input.investigationId))
      .orderBy(desc(schema.releases.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    const [contribution] = await tx
      .insert(schema.contributions)
      .values({
        contributorId: input.userId,
        method: "release@1",
        payloadHash: contentHash(
          `${input.investigationId}@v${version}:${cutoff.getTime()}`
        ),
        sessionId: input.investigationId,
      })
      .returning({ id: schema.contributions.id });
    const [row] = await tx
      .insert(schema.releases)
      .values({
        investigationId: input.investigationId,
        titleSnapshot: inv.title,
        version,
        name: input.name?.trim() ? input.name.trim().slice(0, 200) : null,
        notes: input.notes?.trim() ? input.notes.trim().slice(0, 4000) : null,
        cutoff,
        hops,
        createdBy: input.userId,
        contributionId: contribution.id,
      })
      .returning();
    return row;
  });
  const [creator] = await db
    .select({ displayName: schema.contributors.displayName })
    .from(schema.contributors)
    .where(eq(schema.contributors.id, input.userId))
    .limit(1);
  return { release: toRecord(release, creator?.displayName ?? "unknown") };
}

export async function getRelease(
  id: string
): Promise<(ReleaseRecord & { hops: ScopeHop[] }) | null> {
  const [row] = await db
    .select()
    .from(schema.releases)
    .leftJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.releases.createdBy)
    )
    .where(eq(schema.releases.id, id))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    ...toRecord(row.releases, row.contributors?.displayName ?? "unknown"),
    hops: parseScopeHops(row.releases.hops),
  };
}

export function listReleases(
  investigationId: string
): Promise<ReleaseRecord[]> {
  return db
    .select()
    .from(schema.releases)
    .leftJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.releases.createdBy)
    )
    .where(eq(schema.releases.investigationId, investigationId))
    .orderBy(desc(schema.releases.version))
    .then((rows) =>
      rows.map((r) =>
        toRecord(r.releases, r.contributors?.displayName ?? "unknown")
      )
    );
}

/** Resolve the frozen graph: materialized hops + the as-of cap. The
 * investigation id is deliberately NOT consulted — the recipe stands alone,
 * so the page keeps rendering after the room is deleted. */
export function releaseGraph(release: {
  hops: ScopeHop[];
  cutoff: string;
}): Promise<GraphPayload> {
  return buildGraphData(null, {
    hopsOverride: release.hops,
    asOf: new Date(release.cutoff).getTime(),
  });
}
