import "server-only";
import { createDb, schema } from "@epistack/db";
import { desc, eq, like } from "drizzle-orm";
import { searchCommons } from "@/lib/commons-search";
import {
  buildGraphData,
  type GraphEdgeData,
  type GraphNodeData,
  type GraphPayload,
  type NodeProvenance,
} from "@/lib/graph-data";

// Topic slices — the export surface of the commons. A topic stores only its
// recipe (seed query + pinned claims); membership is computed here at read
// time: FTS seeds, then a bounded traversal outward. The slice is LIVING —
// new investigations that touch the topic's neighborhood join it on the next
// read, which is the compounding property the export exists to demonstrate.

const db = createDb();

/** Hard ceiling on slice size — keeps public pages and MCP payloads bounded. */
const MAX_TOPIC_NODES = 150;
/** How many hops out from the seed set the slice reaches. */
const TRAVERSAL_DEPTH = 2;
const SEED_LIMIT = 40;
const SLUG_MAX = 64;
const SLUG_RETRY_LIMIT = 100;

const NON_ALNUM = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

export type TopicRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seedQuery: string;
  pinnedClaimIds: string[];
  creatorId: string;
  creatorName: string;
  createdAt: string;
};

export type TopicStats = {
  claims: number;
  sources: number;
  hypotheses: number;
  cruxes: number;
  relations: number;
  challenges: number;
  contributors: number;
};

export type TopicListItem = TopicRecord & { stats: TopicStats };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(NON_ALNUM, "-")
    .replace(EDGE_DASHES, "")
    .slice(0, SLUG_MAX)
    .replace(EDGE_DASHES, "");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string");
}

type TopicRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seedQuery: string;
  pinnedClaimIds: unknown;
  creatorId: string;
  creatorName: string | null;
  createdAt: Date;
};

function toRecord(row: TopicRow): TopicRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    seedQuery: row.seedQuery,
    pinnedClaimIds: asStringArray(row.pinnedClaimIds),
    creatorId: row.creatorId,
    creatorName: row.creatorName ?? "unknown",
    createdAt: row.createdAt.toISOString(),
  };
}

const topicColumns = {
  id: schema.topics.id,
  slug: schema.topics.slug,
  name: schema.topics.name,
  description: schema.topics.description,
  seedQuery: schema.topics.seedQuery,
  pinnedClaimIds: schema.topics.pinnedClaimIds,
  creatorId: schema.topics.creatorId,
  creatorName: schema.contributors.displayName,
  createdAt: schema.topics.createdAt,
};

export async function getTopic(slug: string): Promise<TopicRecord | null> {
  const rows = await db
    .select(topicColumns)
    .from(schema.topics)
    .leftJoin(
      schema.contributors,
      eq(schema.topics.creatorId, schema.contributors.id)
    )
    .where(eq(schema.topics.slug, slug))
    .limit(1);
  const row = rows.at(0);
  return row ? toRecord(row) : null;
}

// ── slice membership ─────────────────────────────────────────────────────────

async function collectSeeds(
  payload: GraphPayload,
  seedQuery: string,
  pinnedClaimIds: string[]
): Promise<Set<string>> {
  const present = new Set(payload.nodes.map((n) => n.id));
  const hits = await searchCommons({
    query: seedQuery,
    mode: "or",
    limit: SEED_LIMIT,
  });
  const seeds = new Set<string>();
  for (const hit of hits) {
    if (present.has(hit.nodeId)) {
      seeds.add(hit.nodeId);
    }
  }
  for (const id of pinnedClaimIds) {
    if (present.has(id)) {
      seeds.add(id);
    }
  }
  return seeds;
}

function buildAdjacency(edges: GraphEdgeData[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const push = (from: string, to: string) => {
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  };
  for (const edge of edges) {
    push(edge.source, edge.target);
    push(edge.target, edge.source);
  }
  // Sorted neighbors + sorted frontier ⇒ the same members survive the node cap
  // on every read — the public preview's layout stays stable across reloads.
  for (const list of adjacency.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }
  return adjacency;
}

function traverse(
  seeds: Set<string>,
  adjacency: Map<string, string[]>
): Set<string> {
  const members = new Set(seeds);
  let frontier = Array.from(seeds).sort((a, b) => a.localeCompare(b));
  for (let depth = 0; depth < TRAVERSAL_DEPTH; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (members.size >= MAX_TOPIC_NODES) {
          return members;
        }
        if (!members.has(neighbor)) {
          members.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next.sort((a, b) => a.localeCompare(b));
  }
  return members;
}

// A claim shown without its evidence would be misleading: after traversal,
// every in-slice claim also pulls its mentioned sources and attached cruxes.
// These are leaves (they can't cascade), so they ride past the node cap.
function attachEvidence(members: Set<string>, edges: GraphEdgeData[]): void {
  for (const edge of edges) {
    const attaches = edge.kind === "mention" || edge.kind === "crux";
    if (attaches && members.has(edge.source)) {
      members.add(edge.target);
    }
  }
}

function countsOf(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[]
): GraphPayload["counts"] {
  const byKind = new Map<string, number>();
  let challenges = 0;
  let credences = 0;
  for (const node of nodes) {
    byKind.set(node.kind, (byKind.get(node.kind) ?? 0) + 1);
    challenges += node.challenges?.entries ?? 0;
    if (node.kind === "hypothesis") {
      const summary = node.detail.credence as { history?: unknown[] } | null;
      credences += summary?.history?.length ?? 0;
    }
  }
  for (const edge of edges) {
    challenges += edge.challenges?.entries ?? 0;
  }
  return {
    claims: byKind.get("claim") ?? 0,
    sources: byKind.get("source") ?? 0,
    relations: edges.filter((e) => e.id.startsWith("rel:")).length,
    cruxes: byKind.get("crux") ?? 0,
    hypotheses: byKind.get("hypothesis") ?? 0,
    credences,
    challenges,
  };
}

function filterPayload(
  payload: GraphPayload,
  members: Set<string>
): GraphPayload {
  const nodes = payload.nodes.filter((n) => members.has(n.id));
  const edges = payload.edges.filter(
    (e) => members.has(e.source) && members.has(e.target)
  );
  const provenance: Record<string, NodeProvenance> = {};
  for (const [id, receipt] of Object.entries(payload.provenance)) {
    if (members.has(id)) {
      provenance[id] = receipt;
    }
  }
  const hypotheses = payload.assessment.hypotheses.filter((h) =>
    members.has(`hyp:${h.id}`)
  );
  const openCruxes = nodes.filter((n) => {
    if (n.kind !== "crux") {
      return false;
    }
    const status = n.detail.status as string | null | undefined;
    return status === "open" || !status;
  }).length;
  return {
    nodes,
    edges,
    provenance,
    counts: countsOf(nodes, edges),
    assessment: { hypotheses, openCruxes },
  };
}

async function sliceCommons(
  payload: GraphPayload,
  seedQuery: string,
  pinnedClaimIds: string[]
): Promise<GraphPayload> {
  const seeds = await collectSeeds(payload, seedQuery, pinnedClaimIds);
  const members = traverse(seeds, buildAdjacency(payload.edges));
  attachEvidence(members, payload.edges);
  return filterPayload(payload, members);
}

function statsOf(graph: GraphPayload): TopicStats {
  const contributors = new Set(
    Object.values(graph.provenance).map((p) => p.contributorId)
  );
  return {
    claims: graph.counts.claims,
    sources: graph.counts.sources,
    hypotheses: graph.counts.hypotheses,
    cruxes: graph.counts.cruxes,
    relations: graph.counts.relations,
    challenges: graph.counts.challenges,
    contributors: contributors.size,
  };
}

// ── public API ───────────────────────────────────────────────────────────────

/** The living slice: seeds + traversal, as a filtered GraphPayload. */
export async function resolveTopicSlice(
  slug: string
): Promise<{ topic: TopicRecord; graph: GraphPayload } | null> {
  const topic = await getTopic(slug);
  if (!topic) {
    return null;
  }
  const payload = await buildGraphData(null);
  const graph = await sliceCommons(
    payload,
    topic.seedQuery,
    topic.pinnedClaimIds
  );
  return { topic, graph };
}

/** Publish-dialog preview: what would this recipe capture right now? */
export async function previewTopicSlice(
  seedQuery: string,
  pinnedClaimIds: string[] = []
): Promise<TopicStats> {
  const payload = await buildGraphData(null);
  const graph = await sliceCommons(payload, seedQuery, pinnedClaimIds);
  return statsOf(graph);
}

export async function listTopics(): Promise<TopicListItem[]> {
  const rows = await db
    .select(topicColumns)
    .from(schema.topics)
    .leftJoin(
      schema.contributors,
      eq(schema.topics.creatorId, schema.contributors.id)
    )
    .orderBy(desc(schema.topics.createdAt));
  if (rows.length === 0) {
    return [];
  }
  const payload = await buildGraphData(null);
  return await Promise.all(
    rows.map(async (row) => {
      const record = toRecord(row);
      const graph = await sliceCommons(
        payload,
        record.seedQuery,
        record.pinnedClaimIds
      );
      return { ...record, stats: statsOf(graph) };
    })
  );
}

async function uniqueSlug(base: string): Promise<string> {
  const rows = await db
    .select({ slug: schema.topics.slug })
    .from(schema.topics)
    .where(like(schema.topics.slug, `${base}%`));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; n < SLUG_RETRY_LIMIT; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`no free slug for "${base}"`);
}

export async function createTopic(input: {
  name: string;
  description: string | null;
  seedQuery: string;
  pinnedClaimIds?: string[];
  creatorId: string;
}): Promise<{ slug: string } | { error: string }> {
  const name = input.name.trim();
  const seedQuery = input.seedQuery.trim();
  if (!name) {
    return { error: "a name is required" };
  }
  const base = slugify(name);
  if (!base) {
    return { error: "the name must contain letters or numbers" };
  }
  if (!seedQuery) {
    return { error: "a seed query is required" };
  }
  const pinned = input.pinnedClaimIds ?? [];
  const hits = await searchCommons({
    query: seedQuery,
    mode: "or",
    limit: SEED_LIMIT,
  });
  if (hits.length === 0 && pinned.length === 0) {
    return { error: "that seed query matches nothing in the commons yet" };
  }
  const slug = await uniqueSlug(base);
  await db.insert(schema.topics).values({
    slug,
    name,
    description: input.description?.trim() || null,
    seedQuery,
    pinnedClaimIds: pinned,
    creatorId: input.creatorId,
  });
  return { slug };
}
