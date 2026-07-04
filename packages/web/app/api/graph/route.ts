import { createDb, schema } from "@epistack/db";
import { NextResponse } from "next/server";

// Read the commons as a graph (nodes + edges + per-node detail). With
// ?investigation=<sessionId>, scope to what that investigation touched — shared
// claims still appear in every investigation that mentioned them.
const db = createDb();

export async function GET(request: Request) {
  const investigation = new URL(request.url).searchParams.get("investigation");

  const [
    claims,
    relations,
    sources,
    mentions,
    cruxes,
    hypotheses,
    hypLinks,
    contributions,
  ] = await Promise.all([
    db.select().from(schema.claims),
    db.select().from(schema.relations),
    db.select().from(schema.sources),
    db.select().from(schema.mentions),
    db.select().from(schema.cruxes),
    db.select().from(schema.hypotheses),
    db.select().from(schema.hypothesisLinks),
    db
      .select({
        id: schema.contributions.id,
        sessionId: schema.contributions.sessionId,
      })
      .from(schema.contributions),
  ]);

  const sessionOf = new Map(contributions.map((c) => [c.id, c.sessionId]));
  const inScope = (contributionId: string) =>
    !investigation || sessionOf.get(contributionId) === investigation;

  const scopedMentions = mentions.filter((m) => inScope(m.contributionId));
  const scopedRelations = relations.filter((r) => inScope(r.contributionId));
  const scopedCruxes = cruxes.filter((x) => inScope(x.contributionId));
  const scopedHypLinks = hypLinks.filter((l) => inScope(l.contributionId));
  const scopedHypotheses = hypotheses.filter(
    (h) => !investigation || h.sessionId === investigation
  );

  const claimIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (const m of scopedMentions) {
    claimIds.add(m.claimId);
    sourceIds.add(m.sourceId);
  }
  for (const r of scopedRelations) {
    claimIds.add(r.fromClaimId);
    claimIds.add(r.toClaimId);
  }
  for (const x of scopedCruxes) {
    if (x.claimId) {
      claimIds.add(x.claimId);
    }
  }
  for (const l of scopedHypLinks) {
    claimIds.add(l.claimId);
  }

  const claimById = new Map(claims.map((c) => [c.canonicalId, c]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const scopedClaims = investigation
    ? [...claimIds]
        .map((id) => claimById.get(id))
        .filter((c) => c !== undefined)
    : claims;
  const scopedSources = investigation
    ? [...sourceIds]
        .map((id) => sourceById.get(id))
        .filter((s) => s !== undefined)
    : sources;

  const mentionsByClaim = new Map<
    string,
    Array<{ sourceId: string; quote: string }>
  >();
  for (const m of scopedMentions) {
    const list = mentionsByClaim.get(m.claimId) ?? [];
    list.push({ sourceId: m.sourceId, quote: m.quote });
    mentionsByClaim.set(m.claimId, list);
  }

  const nodes = [
    ...scopedClaims.map((c) => {
      const d = (c.descriptors ?? {}) as Record<string, unknown>;
      return {
        id: c.canonicalId,
        kind: "claim" as const,
        label: c.text,
        sources: mentionsByClaim.get(c.canonicalId)?.length ?? 0,
        position: (d.position as string) ?? null,
        detail: {
          discipline: d.discipline ?? null,
          position: d.position ?? null,
          evidence_type: d.evidence_type ?? null,
          era: d.era ?? null,
          modality: c.modality,
          mentions: mentionsByClaim.get(c.canonicalId) ?? [],
        },
      };
    }),
    ...scopedSources.map((s) => ({
      id: s.id,
      kind: "source" as const,
      label: s.title ?? s.url ?? "source",
      detail: {
        url: s.url,
        author: s.author,
        venue: s.publisher,
        date: s.publishedDate,
        peer_reviewed:
          (s.guarantees as Record<string, unknown> | null)?.peer_reviewed ??
          null,
      },
    })),
    ...scopedCruxes.map((x) => ({
      id: `crux:${x.id}`,
      kind: "crux" as const,
      label: x.question,
      detail: { implication: x.implication, status: x.status },
    })),
    ...scopedHypotheses.map((h) => ({
      id: `hyp:${h.id}`,
      kind: "hypothesis" as const,
      label: h.statement,
      detail: { answer_bearing: h.answerBearing },
    })),
  ];

  const edges = [
    ...scopedRelations.map((r) => ({
      id: `rel:${r.id}`,
      source: r.fromClaimId,
      target: r.toClaimId,
      kind: r.type,
    })),
    ...scopedMentions.map((m) => ({
      id: `men:${m.id}`,
      source: m.claimId,
      target: m.sourceId,
      kind: "mention" as const,
    })),
    ...scopedCruxes
      .filter((x) => x.claimId)
      .map((x) => ({
        id: `cx:${x.id}`,
        source: x.claimId as string,
        target: `crux:${x.id}`,
        kind: "crux" as const,
      })),
    ...scopedHypLinks.map((l) => ({
      id: `hl:${l.id}`,
      source: l.claimId,
      target: `hyp:${l.hypothesisId}`,
      kind:
        l.polarity === "supports"
          ? ("hyp_supports" as const)
          : ("hyp_undermines" as const),
      diagnosticity: l.diagnosticity,
    })),
  ];

  // Holistic assessment: how supported each hypothesis is (linked claims weighted
  // by diagnosticity), and how much residual uncertainty remains (open cruxes).
  const assessment = {
    hypotheses: scopedHypotheses.map((h) => {
      const links = scopedHypLinks.filter((l) => l.hypothesisId === h.id);
      let support = 0;
      let undermine = 0;
      for (const l of links) {
        const w = l.diagnosticity ?? 0.3;
        if (l.polarity === "supports") {
          support += w;
        } else {
          undermine += w;
        }
      }
      return {
        id: h.id,
        statement: h.statement,
        answerBearing: h.answerBearing,
        support,
        undermine,
        claimCount: links.length,
      };
    }),
    openCruxes: scopedCruxes.filter((x) => x.status === "open" || !x.status)
      .length,
  };

  return NextResponse.json({
    nodes,
    edges,
    counts: {
      claims: scopedClaims.length,
      sources: scopedSources.length,
      relations: scopedRelations.length,
      cruxes: scopedCruxes.length,
      hypotheses: scopedHypotheses.length,
    },
    assessment,
  });
}
