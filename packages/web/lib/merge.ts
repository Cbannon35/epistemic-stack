import "server-only";
import { createDb, schema } from "@epistack/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { contentHash } from "@/lib/content-hash";
import {
  buildGraphData,
  type GraphEdgeData,
  type GraphNodeData,
  type NodeProvenance,
} from "@/lib/graph-data";
import {
  getAncestorChain,
  getScopeHops,
  minCutoff,
  type ScopeHop,
} from "@/lib/investigations";
import type {
  MergeDiffCounts,
  MergeRequestRecord,
  MergeStatus,
} from "@/lib/merge-types";

// Merge requests: a fork proposing itself back into an ancestor's visible
// scope. Merging is SCOPE ADOPTION, not content copying — the fork's
// contributions already live in the commons; acceptance widens the target
// lineage's read scope by materializing the fork's hops onto the MR row.
// The commons receipt is the `merge@1` contribution written at accept time
// (whose insert also repaints every client via the realtime publication).

const db = createDb();

export type MergeDiff = {
  incoming: {
    nodes: GraphNodeData[];
    edges: GraphEdgeData[];
    provenance: Record<string, NodeProvenance>;
  };
  counts: MergeDiffCounts;
};

/** The source's live hops not already covered by the target's scope — what
 * acceptance would adopt. Computed live for previews; frozen onto the row
 * (cutoffs min-composed with the accept moment) at accept time. */
export async function previewHops(
  sourceId: string,
  targetId: string
): Promise<ScopeHop[]> {
  const [sourceHops, targetHops] = await Promise.all([
    getScopeHops(sourceId),
    getScopeHops(targetId),
  ]);
  const covered = new Set(targetHops.flatMap((h) => h.sessionIds));
  return sourceHops
    .map((hop) => ({
      sessionIds: hop.sessionIds.filter((id) => !covered.has(id)),
      cutoff: hop.cutoff,
    }))
    .filter((hop) => hop.sessionIds.length > 0);
}

/** The FULL scope a reviewer previews: the target's own hops plus the
 * source's uncovered ones — one walk per side (the graph route would
 * otherwise re-walk the target inside buildGraphData). */
export async function mergePreviewScope(
  sourceId: string,
  targetId: string
): Promise<ScopeHop[]> {
  const [sourceHops, targetHops] = await Promise.all([
    getScopeHops(sourceId),
    getScopeHops(targetId),
  ]);
  const covered = new Set(targetHops.flatMap((h) => h.sessionIds));
  const extras = sourceHops
    .map((hop) => ({
      sessionIds: hop.sessionIds.filter((id) => !covered.has(id)),
      cutoff: hop.cutoff,
    }))
    .filter((hop) => hop.sessionIds.length > 0);
  return [...targetHops, ...extras];
}

/** Nodes/edges the target would gain — computed from both scopes' payloads.
 * Append-only graphs have no "modified": additions ARE the diff. */
export async function computeMergeDiff(
  sourceId: string,
  targetId: string
): Promise<MergeDiff> {
  const [source, target] = await Promise.all([
    buildGraphData(sourceId),
    buildGraphData(targetId),
  ]);
  const targetNodeIds = new Set(target.nodes.map((n) => n.id));
  const targetEdgeIds = new Set(target.edges.map((e) => e.id));
  const nodes = source.nodes.filter((n) => !targetNodeIds.has(n.id));
  const edges = source.edges.filter((e) => !targetEdgeIds.has(e.id));
  const provenance: Record<string, NodeProvenance> = {};
  for (const node of nodes) {
    const p = source.provenance[node.id];
    if (p) {
      provenance[node.id] = p;
    }
  }
  const sourceNodeIds = new Set(source.nodes.map((n) => n.id));
  return {
    incoming: { nodes, edges, provenance },
    counts: {
      incoming: nodes.length,
      shared: source.nodes.filter((n) => targetNodeIds.has(n.id)).length,
      targetOnly: target.nodes.filter((n) => !sourceNodeIds.has(n.id)).length,
    },
  };
}

export type OpenMergeResult = { id: string } | { error: string };

export async function openMergeRequest(input: {
  sourceId: string;
  targetId: string;
  proposerId: string;
  note?: string | null;
}): Promise<OpenMergeResult> {
  if (input.sourceId === input.targetId) {
    return { error: "an investigation cannot merge into itself" };
  }
  // The target must be an ancestor of the source — merges flow down the fork
  // lineage (any hop, not only the direct parent), mirroring PRs into
  // upstream. Cross-lineage merges are a possible future loosening.
  const chain = await getAncestorChain(input.sourceId);
  if (chain.length === 0 || !chain[0]) {
    return { error: "that investigation no longer exists" };
  }
  if (!chain.some((hop, i) => i > 0 && hop.id === input.targetId)) {
    return { error: "merges must target an ancestor of this fork" };
  }
  const [existing] = await db
    .select({ id: schema.mergeRequests.id })
    .from(schema.mergeRequests)
    .where(
      and(
        eq(schema.mergeRequests.sourceId, input.sourceId),
        eq(schema.mergeRequests.targetId, input.targetId),
        eq(schema.mergeRequests.status, "open")
      )
    )
    .limit(1);
  if (existing) {
    return { error: "an open merge request for this pair already exists" };
  }
  const [row] = await db
    .insert(schema.mergeRequests)
    .values({
      sourceId: input.sourceId,
      targetId: input.targetId,
      proposerId: input.proposerId,
      note: input.note?.trim() ? input.note.trim().slice(0, 2000) : null,
    })
    .returning({ id: schema.mergeRequests.id });
  return { id: row.id };
}

export type DecideMergeResult =
  | { ok: true; sourceId: string; targetId: string }
  | { error: string };

export async function decideMergeRequest(input: {
  mrId: string;
  reviewerId: string;
  decision: "accepted" | "declined";
  decisionNote?: string | null;
}): Promise<DecideMergeResult> {
  const [mr] = await db
    .select()
    .from(schema.mergeRequests)
    .where(eq(schema.mergeRequests.id, input.mrId))
    .limit(1);
  if (!mr) {
    return { error: "that merge request no longer exists" };
  }
  if (mr.status !== "open") {
    return { error: `this merge request was already ${mr.status}` };
  }
  const [target] = await db
    .select({ contributorId: schema.investigations.contributorId })
    .from(schema.investigations)
    .where(eq(schema.investigations.id, mr.targetId))
    .limit(1);
  if (!target) {
    return { error: "the target investigation no longer exists" };
  }
  // Owner-only review: merging changes what everyone in the target lineage
  // sees — the review gate is the point of the flow (GitHub-maintainer
  // analog). Proposing and withdrawing stay open to their actors.
  if (target.contributorId !== input.reviewerId) {
    return { error: "only the target investigation's owner can decide this" };
  }

  const decidedAt = new Date();
  const note = input.decisionNote?.trim()
    ? input.decisionNote.trim().slice(0, 2000)
    : null;

  if (input.decision === "declined") {
    const updated = await db
      .update(schema.mergeRequests)
      .set({
        status: "declined",
        reviewerId: input.reviewerId,
        decidedAt,
        decisionNote: note,
        updatedAt: decidedAt,
      })
      .where(
        and(
          eq(schema.mergeRequests.id, input.mrId),
          eq(schema.mergeRequests.status, "open")
        )
      )
      .returning({ id: schema.mergeRequests.id });
    return updated.length > 0
      ? { ok: true, sourceId: mr.sourceId, targetId: mr.targetId }
      : { error: "this merge request was already decided" };
  }

  // Accept: freeze what the reviewer approved. Hops are materialized with
  // cutoffs min-composed to the accept moment, so later source-side work
  // never leaks into the target retroactively.
  const live = await previewHops(mr.sourceId, mr.targetId);
  const mergedHops: ScopeHop[] = live.map((hop) => ({
    sessionIds: hop.sessionIds,
    cutoff: minCutoff(hop.cutoff, decidedAt.getTime()),
  }));
  const [contribution] = await db
    .insert(schema.contributions)
    .values({
      contributorId: input.reviewerId,
      method: "merge@1",
      payloadHash: contentHash(
        `${mr.sourceId}->${mr.targetId}@${decidedAt.getTime()}`
      ),
      sessionId: mr.targetId,
    })
    .returning({ id: schema.contributions.id });
  const updated = await db
    .update(schema.mergeRequests)
    .set({
      status: "accepted",
      reviewerId: input.reviewerId,
      decidedAt,
      decisionNote: note,
      mergedHops,
      contributionId: contribution.id,
      updatedAt: decidedAt,
    })
    .where(
      and(
        eq(schema.mergeRequests.id, input.mrId),
        eq(schema.mergeRequests.status, "open")
      )
    )
    .returning({ id: schema.mergeRequests.id });
  return updated.length > 0
    ? { ok: true, sourceId: mr.sourceId, targetId: mr.targetId }
    : { error: "this merge request was already decided" };
}

export async function withdrawMergeRequest(input: {
  mrId: string;
  userId: string;
}): Promise<DecideMergeResult> {
  const updated = await db
    .update(schema.mergeRequests)
    .set({ status: "withdrawn", updatedAt: new Date() })
    .where(
      and(
        eq(schema.mergeRequests.id, input.mrId),
        eq(schema.mergeRequests.proposerId, input.userId),
        eq(schema.mergeRequests.status, "open")
      )
    )
    .returning({
      id: schema.mergeRequests.id,
      sourceId: schema.mergeRequests.sourceId,
      targetId: schema.mergeRequests.targetId,
    });
  const row = updated.at(0);
  return row
    ? { ok: true, sourceId: row.sourceId, targetId: row.targetId }
    : { error: "only the proposer can withdraw an open merge request" };
}

/** Every MR where the investigation is source or target, newest first. */
export async function listMergeRequests(
  investigationId: string
): Promise<MergeRequestRecord[]> {
  const rows = await db
    .select()
    .from(schema.mergeRequests)
    .leftJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.mergeRequests.proposerId)
    )
    .where(
      or(
        eq(schema.mergeRequests.sourceId, investigationId),
        eq(schema.mergeRequests.targetId, investigationId)
      )
    )
    .orderBy(desc(schema.mergeRequests.createdAt));

  const invIds = [
    ...new Set(
      rows.flatMap((r) => [
        r.merge_requests.sourceId,
        r.merge_requests.targetId,
      ])
    ),
  ];
  const reviewerIds = [
    ...new Set(
      rows
        .map((r) => r.merge_requests.reviewerId)
        .filter((id): id is string => id !== null)
    ),
  ];
  const [titles, reviewers] = await Promise.all([
    invIds.length > 0
      ? db
          .select({
            id: schema.investigations.id,
            title: schema.investigations.title,
          })
          .from(schema.investigations)
          .where(inArray(schema.investigations.id, invIds))
      : Promise.resolve([]),
    reviewerIds.length > 0
      ? db
          .select({
            id: schema.contributors.id,
            displayName: schema.contributors.displayName,
          })
          .from(schema.contributors)
          .where(inArray(schema.contributors.id, reviewerIds))
      : Promise.resolve([]),
  ]);
  const titleOf = new Map(titles.map((t) => [t.id, t.title]));
  const reviewerOf = new Map(reviewers.map((r) => [r.id, r.displayName]));

  return rows.map(({ merge_requests: mr, contributors: proposer }) => ({
    id: mr.id,
    sourceId: mr.sourceId,
    targetId: mr.targetId,
    sourceTitle: titleOf.get(mr.sourceId) ?? null,
    targetTitle: titleOf.get(mr.targetId) ?? null,
    proposerId: mr.proposerId,
    proposerName: proposer?.displayName ?? "unknown",
    note: mr.note,
    status: mr.status as MergeStatus,
    reviewerId: mr.reviewerId,
    reviewerName: mr.reviewerId
      ? (reviewerOf.get(mr.reviewerId) ?? null)
      : null,
    decidedAt: mr.decidedAt ? mr.decidedAt.toISOString() : null,
    decisionNote: mr.decisionNote,
    createdAt: mr.createdAt.toISOString(),
  }));
}

export async function getMergeRequest(mrId: string) {
  const [row] = await db
    .select()
    .from(schema.mergeRequests)
    .where(eq(schema.mergeRequests.id, mrId))
    .limit(1);
  return row ?? null;
}
