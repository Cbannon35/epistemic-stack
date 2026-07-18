"use server";

import type {
  ChallengeType,
  NodeChallengeSummary,
  NodeReceipts,
} from "@/lib/challenge-types";
import {
  challengeSummaryByNode,
  commentThreadSeed,
  fileChallenge,
  getNodeReceipts,
  resolveNodeTarget,
  respondToChallenge,
} from "@/lib/challenges";
import { ensureContributor } from "@/lib/contributors";
import { buildGraphData } from "@/lib/graph-data";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Full chain of custody + challenge history for one graph node. */
export async function getNodeReceiptsAction(
  nodeId: string
): Promise<NodeReceipts | null> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  return getNodeReceipts(nodeId);
}

/** Batched challenge rollups for chat claim cards. */
export async function getChallengeCounts(
  nodeIds: string[]
): Promise<Record<string, NodeChallengeSummary>> {
  const user = await requireUser();
  if (!user || nodeIds.length === 0) {
    return {};
  }
  const summary = await challengeSummaryByNode();
  const wanted: Record<string, NodeChallengeSummary> = {};
  for (const id of nodeIds) {
    if (summary[id]) {
      wanted[id] = summary[id];
    }
  }
  return wanted;
}

export async function fileNodeChallenge(input: {
  nodeId: string;
  challengeType: ChallengeType;
  body: string;
  evidenceUrl?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const body = input.body.trim();
  if (!user) {
    return { ok: false, error: "not signed in" };
  }
  if (!body) {
    return { ok: false, error: "empty challenge" };
  }
  const target = await resolveNodeTarget(input.nodeId);
  if (!target) {
    return { ok: false, error: "this node cannot be challenged" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  await fileChallenge({
    contributorId: user.id,
    target,
    challengeType: input.challengeType,
    body: body.slice(0, 4000),
    evidenceUrl: input.evidenceUrl?.trim() || null,
    sessionId: input.sessionId,
  });
  return { ok: true };
}

export async function respondToChallengeAction(input: {
  challengeId: string;
  body: string;
  evidenceUrl?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const body = input.body.trim();
  if (!(user && body)) {
    return { ok: false };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  const id = await respondToChallenge({
    contributorId: user.id,
    challengeId: input.challengeId,
    body: body.slice(0, 4000),
    evidenceUrl: input.evidenceUrl?.trim() || null,
    sessionId: input.sessionId,
  });
  return { ok: id !== null };
}

export type ChallengeableNode = {
  id: string;
  kind: string;
  label: string;
};

/** In-scope nodes for the comment→challenge target picker. */
export async function listChallengeableNodes(
  sessionId: string | null
): Promise<ChallengeableNode[]> {
  const user = await requireUser();
  if (!user) {
    return [];
  }
  const graph = await buildGraphData(sessionId);
  const nodes: ChallengeableNode[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== "crux") {
      nodes.push({ id: n.id, kind: n.kind, label: n.label });
    }
  }
  return nodes;
}

// Promote a public comment thread to a commons challenge: the quote and the
// discussion become the dispute body against a node the promoter picks.
// Private notes stay private — they can't be promoted.
export async function promoteCommentToChallenge(input: {
  commentId: string;
  nodeId: string;
  challengeType: ChallengeType;
  sessionId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!user) {
    return { ok: false, error: "not signed in" };
  }
  const seed = await commentThreadSeed(input.commentId);
  if (!seed) {
    return { ok: false, error: "comment thread not found" };
  }
  if (seed.visibility !== "public") {
    return { ok: false, error: "private notes cannot be promoted" };
  }
  const target = await resolveNodeTarget(input.nodeId);
  if (!target) {
    return { ok: false, error: "this node cannot be challenged" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  await fileChallenge({
    contributorId: user.id,
    target,
    challengeType: input.challengeType,
    body: seed.body,
    sessionId: input.sessionId,
    method: "promote_comment@1",
  });
  return { ok: true };
}
