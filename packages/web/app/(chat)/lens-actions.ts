"use server";

import { ensureContributor } from "@/lib/contributors";
import { insertLens, listSavedLenses } from "@/lib/lenses/store";
import type { LensDefinition, LensMatch, LensRule } from "@/lib/lenses/types";
import { clampWeight } from "@/lib/lenses/types";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function listLenses(): Promise<LensDefinition[]> {
  const user = await requireUser();
  if (!user) {
    return [];
  }
  return listSavedLenses();
}

const MAX_RULES = 12;

// Re-validate rules server-side: only known match fields survive, weights are
// clamped. Malformed rules are dropped rather than rejected wholesale.
function sanitizeRules(rules: LensRule[]): LensRule[] {
  const out: LensRule[] = [];
  const list = Array.isArray(rules) ? rules : [];
  for (const rule of list.slice(0, MAX_RULES)) {
    if (typeof rule !== "object" || rule === null) {
      continue;
    }
    const match = (rule.match ?? {}) as LensMatch;
    const clean: LensMatch = {};
    if (Array.isArray(match.kinds)) {
      clean.kinds = match.kinds.filter((k) =>
        ["claim", "source", "crux", "hypothesis"].includes(k)
      );
    }
    if (
      match.contributorKind === "human" ||
      match.contributorKind === "agent"
    ) {
      clean.contributorKind = match.contributorKind;
    }
    if (Array.isArray(match.contributorIds)) {
      clean.contributorIds = match.contributorIds
        .filter((id) => typeof id === "string")
        .slice(0, 32);
    }
    if (typeof match.minSources === "number") {
      clean.minSources = Math.max(0, Math.floor(match.minSources));
    }
    if (typeof match.maxSources === "number") {
      clean.maxSources = Math.max(0, Math.floor(match.maxSources));
    }
    if (Array.isArray(match.modality)) {
      clean.modality = match.modality.filter((m) => typeof m === "string");
    }
    if (typeof match.peerReviewed === "boolean") {
      clean.peerReviewed = match.peerReviewed;
    }
    if (typeof match.olderThanDays === "number" && match.olderThanDays > 0) {
      clean.olderThanDays = Math.floor(match.olderThanDays);
    }
    if (Object.keys(clean).length === 0) {
      continue;
    }
    out.push({
      id: typeof rule.id === "string" ? rule.id : `rule-${out.length}`,
      label: String(rule.label ?? "rule").slice(0, 120),
      match: clean,
      weight: clampWeight(rule.weight),
    });
  }
  return out;
}

export async function saveLens(input: {
  name: string;
  description?: string;
  rules: LensRule[];
}): Promise<string | null> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  const name = input.name.trim().slice(0, 60);
  const rules = sanitizeRules(input.rules);
  if (!name || rules.length === 0) {
    return null;
  }
  await ensureContributor(user.id, user.email ?? user.id);
  return insertLens({
    ownerId: user.id,
    name,
    description: input.description?.trim().slice(0, 300) || null,
    rules,
  });
}
