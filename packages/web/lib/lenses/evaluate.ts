// Pure, deterministic lens evaluation. Score = how much trust the active
// lens retains in a node: starts at 1.0, each matching rule multiplies in its
// weight, final clamp to [0, 1]. No I/O — runs client-side over the graph
// payload the panel already fetched.

import type { GraphNode, NodeProvenance } from "@/app/_components/graph/types";
import type { LensDefinition, LensMatch, LensRule } from "./types";

const DAY_MS = 86_400_000;

export type EvalContext = {
  provenance: Record<string, NodeProvenance>;
  nowMs: number;
};

function matchesRule(
  match: LensMatch,
  node: GraphNode,
  receipt: NodeProvenance | undefined,
  nowMs: number
): boolean {
  if (match.kinds && !match.kinds.includes(node.kind)) {
    return false;
  }
  if (
    match.contributorKind &&
    receipt?.contributorKind !== match.contributorKind
  ) {
    return false;
  }
  if (
    match.contributorIds &&
    (!receipt || !match.contributorIds.includes(receipt.contributorId))
  ) {
    return false;
  }
  // Corroboration counts only exist on claims; a rule that asks about them
  // never fires on other kinds.
  if (match.minSources !== undefined || match.maxSources !== undefined) {
    if (typeof node.sources !== "number") {
      return false;
    }
    if (match.minSources !== undefined && node.sources < match.minSources) {
      return false;
    }
    if (match.maxSources !== undefined && node.sources > match.maxSources) {
      return false;
    }
  }
  if (match.modality) {
    const modality = node.detail?.modality;
    if (typeof modality !== "string" || !match.modality.includes(modality)) {
      return false;
    }
  }
  if (match.peerReviewed !== undefined) {
    if (node.kind !== "source") {
      return false;
    }
    if (Boolean(node.detail?.peer_reviewed) !== match.peerReviewed) {
      return false;
    }
  }
  if (match.olderThanDays !== undefined) {
    if (!receipt) {
      return false;
    }
    const age = nowMs - Date.parse(receipt.createdAt);
    if (!(Number.isFinite(age) && age > match.olderThanDays * DAY_MS)) {
      return false;
    }
  }
  return true;
}

export function scoreNode(
  node: GraphNode,
  rules: LensRule[],
  ctx: EvalContext
): number {
  let score = 1;
  const receipt = ctx.provenance[node.id];
  for (const rule of rules) {
    if (matchesRule(rule.match, node, receipt, ctx.nowMs)) {
      score *= rule.weight;
    }
  }
  return Math.min(1, Math.max(0, score));
}

export function scoreAll(
  nodes: GraphNode[],
  lens: LensDefinition,
  ctx: EvalContext
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const node of nodes) {
    scores.set(node.id, scoreNode(node, lens.rules, ctx));
  }
  return scores;
}

// Which rules fired for a node — powers the "why this score" readout.
export function explainScore(
  node: GraphNode,
  rules: LensRule[],
  ctx: EvalContext
): LensRule[] {
  const receipt = ctx.provenance[node.id];
  return rules.filter((rule) =>
    matchesRule(rule.match, node, receipt, ctx.nowMs)
  );
}

export type Divergence = {
  node: GraphNode;
  scoreA: number;
  scoreB: number;
  // Signed: positive = lens A trusts it more, negative = lens B does.
  delta: number;
};

// Rank where two lenses part ways, most-diverging first. Ties break by node
// id so the ordering is stable across renders and clients.
export function computeDivergences(
  nodes: GraphNode[],
  a: LensDefinition,
  b: LensDefinition,
  ctx: EvalContext
): Divergence[] {
  const out: Divergence[] = [];
  for (const node of nodes) {
    const scoreA = scoreNode(node, a.rules, ctx);
    const scoreB = scoreNode(node, b.rules, ctx);
    out.push({ node, scoreA, scoreB, delta: scoreA - scoreB });
  }
  return out.sort(
    (x, y) =>
      Math.abs(y.delta) - Math.abs(x.delta) ||
      x.node.id.localeCompare(y.node.id)
  );
}
