// Lenses — late-binding trust. The commons stores everything from everyone;
// a lens decides, AT READ TIME, how much weight each node deserves. Nothing
// is filtered at write time, so two people can read the same graph through
// different lenses and see exactly where their worldviews part.

import type { NodeKind } from "@/app/_components/graph/types";

// What a rule can look at. All specified fields must hold for the rule to
// fire (AND); fields a node cannot satisfy (e.g. `modality` on a source)
// simply don't match. Provenance fields resolve through the receipt shipped
// with the graph payload.
//
// Extension point (integration): sibling features add dimensions here —
// e.g. `contested?: boolean` once challenge records exist — and teach
// `matchesRule` in evaluate.ts the new field. Unknown fields on stored
// lenses are ignored, so old rows stay valid.
export type LensMatch = {
  kinds?: NodeKind[];
  contributorKind?: "human" | "agent";
  contributorIds?: string[];
  minSources?: number;
  maxSources?: number;
  modality?: string[];
  peerReviewed?: boolean;
  olderThanDays?: number;
};

// One weighting rule: when `match` holds, multiply the node's score by
// `weight` (0 = drop entirely, 1 = neutral, >1 = counterweight a discount).
export type LensRule = {
  id: string;
  label: string;
  match: LensMatch;
  weight: number;
};

export type LensDefinition = {
  id: string;
  name: string;
  description: string | null;
  rules: LensRule[];
  // Set on saved lenses; built-ins carry neither.
  ownerId?: string;
  ownerName?: string;
  builtin?: boolean;
};

// A lens A/B comparison — the "where do our worldviews part?" mode.
export type LensDiff = { a: LensDefinition; b: LensDefinition };

export const MAX_RULE_WEIGHT = 1.5;

export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) {
    return 1;
  }
  return Math.min(MAX_RULE_WEIGHT, Math.max(0, weight));
}

// Parse rules out of a stored `lenses.config` jsonb — tolerant of unknown
// keys and malformed rows (skipped), so schema evolution never breaks reads.
export function rulesFromConfig(config: unknown): LensRule[] {
  if (typeof config !== "object" || config === null) {
    return [];
  }
  const raw = (config as { rules?: unknown }).rules;
  if (!Array.isArray(raw)) {
    return [];
  }
  const rules: LensRule[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const r = entry as Record<string, unknown>;
    if (typeof r.weight !== "number" || typeof r.match !== "object") {
      continue;
    }
    rules.push({
      id: typeof r.id === "string" ? r.id : `rule-${rules.length}`,
      label: typeof r.label === "string" ? r.label : "rule",
      match: (r.match ?? {}) as LensMatch,
      weight: clampWeight(r.weight),
    });
  }
  return rules;
}
