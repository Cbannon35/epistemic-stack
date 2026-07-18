import "server-only";
import { createDb, schema } from "@epistack/db";
import { asc, eq, inArray } from "drizzle-orm";
import { contentHash } from "@/lib/content-hash";

// Belief timeline over hypotheses. Credences are NOT a new table: the schema's
// append-only `assessments` (kind = 'credence') exists precisely so belief is
// attributed, receipted, and late-binding — a lens can reweight it at read
// time. Each registration = one contribution (the receipt) + one assessment.
// History is never mutated; "current" = each assessor's latest row.

const db = createDb();

const CREDENCE_METHOD = "record_credence@1";

export type CredenceEntry = {
  hypothesisId: string;
  assessorId: string;
  assessorName: string;
  /** 0..1 as stored; UI renders 0–100. */
  value: number;
  rationale: string | null;
  createdAt: string;
};

export async function recordCredence(input: {
  hypothesisId: string;
  contributorId: string;
  /** 0–100 from the UI. */
  value: number;
  note?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const value = Math.round(Math.min(100, Math.max(0, input.value))) / 100;
  const [hyp] = await db
    .select({ id: schema.hypotheses.id })
    .from(schema.hypotheses)
    .where(eq(schema.hypotheses.id, input.hypothesisId))
    .limit(1);
  if (!hyp) {
    return { ok: false, error: "hypothesis not found" };
  }
  const payload = `${input.hypothesisId}:${value}`;
  const [contribution] = await db
    .insert(schema.contributions)
    .values({
      contributorId: input.contributorId,
      method: CREDENCE_METHOD,
      payloadHash: contentHash(payload),
      sessionId: input.sessionId ?? null,
    })
    .returning({ id: schema.contributions.id });
  await db.insert(schema.assessments).values({
    assessorId: input.contributorId,
    kind: "credence",
    hypothesisId: input.hypothesisId,
    credence: value,
    method: CREDENCE_METHOD,
    rationale: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
    contributionId: contribution.id,
  });
  return { ok: true };
}

// Full credence history (oldest first) for a set of hypotheses — feeds both
// the community average (latest per assessor) and the trajectory sparkline.
export async function listCredences(
  hypothesisIds?: string[]
): Promise<CredenceEntry[]> {
  if (hypothesisIds && hypothesisIds.length === 0) {
    return [];
  }
  const base = db
    .select({
      hypothesisId: schema.assessments.hypothesisId,
      assessorId: schema.assessments.assessorId,
      assessorName: schema.contributors.displayName,
      value: schema.assessments.credence,
      rationale: schema.assessments.rationale,
      createdAt: schema.contributions.createdAt,
    })
    .from(schema.assessments)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.assessments.assessorId)
    )
    .innerJoin(
      schema.contributions,
      eq(schema.contributions.id, schema.assessments.contributionId)
    );
  const rows = await (hypothesisIds
    ? base.where(inArray(schema.assessments.hypothesisId, hypothesisIds))
    : base
  ).orderBy(asc(schema.contributions.createdAt));
  const entries: CredenceEntry[] = [];
  for (const r of rows) {
    if (r.hypothesisId == null || r.value == null) {
      continue;
    }
    entries.push({
      hypothesisId: r.hypothesisId,
      assessorId: r.assessorId,
      assessorName: r.assessorName,
      value: r.value,
      rationale: r.rationale,
      createdAt: r.createdAt.toISOString(),
    });
  }
  return entries;
}

export type CredenceSummary = {
  /** Mean of each assessor's latest credence, 0..1. */
  average: number;
  assessors: number;
  history: Array<{
    t: number;
    value: number;
    assessorId: string;
    assessorName: string;
  }>;
};

// Community credence = mean over assessors' LATEST values; history keeps every
// append-only entry so the sparkline can replay how belief moved.
export function summarizeCredences(
  entries: CredenceEntry[]
): Map<string, CredenceSummary> {
  const byHypothesis = new Map<string, CredenceEntry[]>();
  for (const entry of entries) {
    const list = byHypothesis.get(entry.hypothesisId) ?? [];
    list.push(entry);
    byHypothesis.set(entry.hypothesisId, list);
  }
  const out = new Map<string, CredenceSummary>();
  for (const [hypothesisId, list] of byHypothesis) {
    const latestByAssessor = new Map<string, number>();
    for (const entry of list) {
      latestByAssessor.set(entry.assessorId, entry.value);
    }
    const values = [...latestByAssessor.values()];
    out.set(hypothesisId, {
      average: values.reduce((a, b) => a + b, 0) / values.length,
      assessors: values.length,
      history: list.map((entry) => ({
        t: Date.parse(entry.createdAt),
        value: entry.value,
        assessorId: entry.assessorId,
        assessorName: entry.assessorName,
      })),
    });
  }
  return out;
}
