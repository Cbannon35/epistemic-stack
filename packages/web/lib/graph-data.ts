import "server-only";
import { createDb, schema } from "@epistack/db";
import { getAncestorChain } from "@/lib/investigations";

// Read the commons as a graph (nodes + edges + per-node detail). With an
// investigation id, scope to what that investigation — and its fork ancestors —
// touched; shared claims still appear in every investigation that mentioned
// them. Serves both the /api/graph route and the tour generator.

const db = createDb();

export type GraphNodeData = {
  id: string;
  kind: "claim" | "source" | "crux" | "hypothesis";
  label: string;
  sources?: number;
  position?: string | null;
  detail: Record<string, unknown>;
};

export type GraphEdgeData = {
  id: string;
  source: string;
  target: string;
  kind: string;
  diagnosticity?: number | null;
};

// The receipt behind a node, resolved for read-time trust (lenses): who wrote
// it, by what method, when. Keyed by node id alongside nodes/edges.
export type NodeProvenance = {
  contributorId: string;
  contributorName: string;
  contributorKind: "human" | "agent";
  method: string;
  createdAt: string;
};

export type GraphPayload = {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  provenance: Record<string, NodeProvenance>;
  counts: {
    claims: number;
    sources: number;
    relations: number;
    cruxes: number;
    hypotheses: number;
  };
  assessment: {
    hypotheses: Array<{
      id: string;
      statement: string;
      answerBearing: string | null;
      support: number;
      undermine: number;
      claimCount: number;
    }>;
    openCruxes: number;
  };
};

export async function buildGraphData(
  investigation: string | null
): Promise<GraphPayload> {
  // A fork inherits its ancestors' graph: scope = the whole lineage chain.
  const scope = investigation
    ? new Set(await getAncestorChain(investigation))
    : null;

  const [
    claims,
    relations,
    sources,
    mentions,
    cruxes,
    hypotheses,
    hypLinks,
    contributions,
    contributorRows,
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
        contributorId: schema.contributions.contributorId,
        method: schema.contributions.method,
        createdAt: schema.contributions.createdAt,
      })
      .from(schema.contributions),
    db
      .select({
        id: schema.contributors.id,
        kind: schema.contributors.kind,
        displayName: schema.contributors.displayName,
      })
      .from(schema.contributors),
  ]);

  const sessionOf = new Map(contributions.map((c) => [c.id, c.sessionId]));
  const inScope = (contributionId: string) => {
    if (!scope) {
      return true;
    }
    const sessionId = sessionOf.get(contributionId);
    return sessionId != null && scope.has(sessionId);
  };

  const scopedMentions = mentions.filter((m) => inScope(m.contributionId));
  const scopedRelations = relations.filter((r) => inScope(r.contributionId));
  const scopedCruxes = cruxes.filter((x) => inScope(x.contributionId));
  const scopedHypLinks = hypLinks.filter((l) => inScope(l.contributionId));
  const scopedHypotheses = hypotheses.filter(
    (h) => !scope || (h.sessionId != null && scope.has(h.sessionId))
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
  const scopedClaims = scope
    ? [...claimIds]
        .map((id) => claimById.get(id))
        .filter((c) => c !== undefined)
    : claims;
  const scopedSources = scope
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

  const nodes: GraphNodeData[] = [
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

  const edges: GraphEdgeData[] = [
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

  // Provenance: resolve each node's contribution back to who/how/when — the
  // receipt the lens layer weighs at read time.
  const contributionById = new Map(contributions.map((c) => [c.id, c]));
  const contributorById = new Map(contributorRows.map((c) => [c.id, c]));
  const provenance: Record<string, NodeProvenance> = {};
  const addProvenance = (nodeId: string, contributionId: string) => {
    const contribution = contributionById.get(contributionId);
    if (!contribution) {
      return;
    }
    const contributor = contributorById.get(contribution.contributorId);
    provenance[nodeId] = {
      contributorId: contribution.contributorId,
      contributorName: contributor?.displayName ?? "unknown",
      contributorKind: contributor?.kind ?? "human",
      method: contribution.method,
      createdAt: contribution.createdAt.toISOString(),
    };
  };
  for (const c of scopedClaims) {
    addProvenance(c.canonicalId, c.contributionId);
  }
  for (const s of scopedSources) {
    addProvenance(s.id, s.contributionId);
  }
  for (const x of scopedCruxes) {
    addProvenance(`crux:${x.id}`, x.contributionId);
  }
  for (const h of scopedHypotheses) {
    addProvenance(`hyp:${h.id}`, h.contributionId);
  }

  // Holistic assessment: how supported each hypothesis is (linked claims
  // weighted by diagnosticity), and the residual uncertainty (open cruxes).
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

  return {
    nodes,
    edges,
    provenance,
    counts: {
      claims: scopedClaims.length,
      sources: scopedSources.length,
      relations: scopedRelations.length,
      cruxes: scopedCruxes.length,
      hypotheses: scopedHypotheses.length,
    },
    assessment,
  };
}
