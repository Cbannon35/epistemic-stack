import "server-only";
import { createDb, schema } from "@epistack/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { ChallengeThread, NodeReceipts } from "@/lib/challenge-types";
import { getNodeReceipts } from "@/lib/challenges";
import { type CommonsHit, searchCommons } from "@/lib/commons-search";
import { listCredences, summarizeCredences } from "@/lib/credences";
import { citationFor } from "@/lib/release-types";
import { getRelease, listAllReleases, releaseGraph } from "@/lib/releases";
import { listTopics, resolveTopicSlice, type TopicRecord } from "@/lib/topics";

// The commons' MCP tool surface — READ ONLY by design. External assistants
// query the graph; they never write to it (no contributions are recorded
// here). `search` + `fetch` follow ChatGPT's data-connector contract; the
// rest are richer views for any MCP client. A scope narrows every tool to
// one topic slice (the per-topic connector URLs).

const db = createDb();

const SEARCH_LIMIT = 20;
const TITLE_MAX = 200;
const TOP_CLAIMS = 20;

export type McpScope = {
  /** Request origin, for citable result URLs. */
  origin: string;
  /** Non-null on the per-topic servers. */
  topic: TopicRecord | null;
  /** Node ids in the topic slice when scoped. */
  memberIds: Set<string> | null;
};

function pageUrl(scope: McpScope): string {
  return scope.topic
    ? `${scope.origin}/topics/${scope.topic.slug}`
    : `${scope.origin}/topics`;
}

function inScope(scope: McpScope, nodeId: string): boolean {
  return scope.memberIds === null || scope.memberIds.has(nodeId);
}

function clip(text: string, max = TITLE_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asText(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function notFound(scope: McpScope, id: string) {
  const where = scope.topic ? `topic "${scope.topic.slug}"` : "the commons";
  return asText({ error: `no node "${id}" in ${where}` });
}

// ── search / fetch (ChatGPT data-connector contract) ─────────────────────────

async function runSearch(
  scope: McpScope,
  query: string
): Promise<CommonsHit[]> {
  // "and" (websearch semantics) first; fall back to "or" so question-shaped
  // queries still land.
  let hits = await searchCommons({ query, mode: "and", limit: SEARCH_LIMIT });
  if (hits.length === 0) {
    hits = await searchCommons({ query, mode: "or", limit: SEARCH_LIMIT });
  }
  return hits.filter((h) => inScope(scope, h.nodeId));
}

function searchResult(scope: McpScope, hit: CommonsHit) {
  return {
    id: hit.nodeId,
    title: `[${hit.kind}] ${clip(hit.text)}`,
    url: pageUrl(scope),
  };
}

function receiptLine(receipts: NodeReceipts): string {
  const created = receipts.created;
  if (!created) {
    return "chain of custody: unknown";
  }
  const parts = [
    `recorded by ${created.contributor.name} (${created.contributor.kind}) via ${created.method} on ${created.createdAt}`,
  ];
  if (created.askedBy) {
    parts.push(`during a turn asked by ${created.askedBy}`);
  }
  if (created.investigation) {
    parts.push(`in investigation "${created.investigation.title}"`);
  }
  return `chain of custody: ${parts.join(", ")}`;
}

function threadLines(threads: ChallengeThread[]): string[] {
  const lines: string[] = [];
  for (const t of threads) {
    const kind = t.challenge.challengeType ?? "challenge";
    const evidence = t.challenge.evidenceUrl
      ? ` (evidence: ${t.challenge.evidenceUrl})`
      : "";
    lines.push(
      `- [${kind}] ${t.challenge.authorName}: ${t.challenge.body}${evidence}`
    );
    for (const r of t.responses) {
      lines.push(`  - response, ${r.authorName}: ${r.body}`);
    }
  }
  return lines;
}

function composeDocument(receipts: NodeReceipts): string {
  const lines: string[] = [
    `# ${receipts.label}`,
    "",
    `kind: ${receipts.kind} · dispute state: ${receipts.state}`,
  ];
  if (receipts.mentions.length > 0) {
    lines.push("", "## Evidence (verbatim quotes)");
    for (const m of receipts.mentions) {
      const source = m.sourceTitle ?? m.sourceId;
      const url = m.sourceUrl ? ` (${m.sourceUrl})` : "";
      lines.push(`- "${m.quote}" — ${source}${url}`);
    }
  }
  if (receipts.threads.length > 0) {
    lines.push("", "## Challenges", ...threadLines(receipts.threads));
  }
  lines.push("", "## Receipts", receiptLine(receipts));
  return lines.join("\n");
}

function registerSearchAndFetch(server: McpServer, scope: McpScope): void {
  const where = scope.topic
    ? `the "${scope.topic.name}" topic slice`
    : "the whole epistemic commons";
  server.registerTool(
    "search",
    {
      title: "Search the commons",
      description: `Full-text search over claims, hypotheses, cruxes, and sources in ${where}. Returns node ids for use with fetch/get_claim/get_hypothesis.`,
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const hits = await runSearch(scope, query);
      return asText({ results: hits.map((h) => searchResult(scope, h)) });
    }
  );
  server.registerTool(
    "fetch",
    {
      title: "Fetch a node with receipts",
      description:
        "Fetch one node (claim/source/hypothesis/crux) as a document: verbatim source quotes, challenge threads, and its chain-of-custody receipt.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      if (!inScope(scope, id)) {
        return notFound(scope, id);
      }
      const receipts = await getNodeReceipts(id);
      if (!receipts) {
        return notFound(scope, id);
      }
      return asText({
        id,
        title: clip(receipts.label),
        text: composeDocument(receipts),
        url: pageUrl(scope),
        metadata: {
          kind: receipts.kind,
          disputeState: receipts.state,
          contributor: receipts.created?.contributor.name ?? null,
          method: receipts.created?.method ?? null,
          createdAt: receipts.created?.createdAt ?? null,
        },
      });
    }
  );
}

// ── richer graph views ───────────────────────────────────────────────────────

async function claimRelations(claimId: string) {
  const rows = await db
    .select()
    .from(schema.relations)
    .where(
      or(
        eq(schema.relations.fromClaimId, claimId),
        eq(schema.relations.toClaimId, claimId)
      )
    );
  const otherIds = [
    ...new Set(
      rows.map((r) => (r.fromClaimId === claimId ? r.toClaimId : r.fromClaimId))
    ),
  ];
  const texts =
    otherIds.length > 0
      ? await db
          .select({
            canonicalId: schema.claims.canonicalId,
            text: schema.claims.text,
          })
          .from(schema.claims)
          .where(inArray(schema.claims.canonicalId, otherIds))
      : [];
  const textOf = new Map(texts.map((t) => [t.canonicalId, t.text]));
  return rows.map((r) => ({
    type: r.type,
    direction: r.fromClaimId === claimId ? "outgoing" : "incoming",
    otherClaimId: r.fromClaimId === claimId ? r.toClaimId : r.fromClaimId,
    otherClaimText: clip(
      textOf.get(r.fromClaimId === claimId ? r.toClaimId : r.fromClaimId) ?? ""
    ),
    rationale: r.rationale,
  }));
}

function registerGetClaim(server: McpServer, scope: McpScope): void {
  server.registerTool(
    "get_claim",
    {
      title: "Get a claim in full",
      description:
        "One claim with its verbatim evidence quotes, typed relations to other claims (supports/contradicts/…), challenge threads, and receipts.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      if (!inScope(scope, id)) {
        return notFound(scope, id);
      }
      const [claim] = await db
        .select()
        .from(schema.claims)
        .where(eq(schema.claims.canonicalId, id))
        .limit(1);
      if (!claim) {
        return notFound(scope, id);
      }
      const [receipts, relations] = await Promise.all([
        getNodeReceipts(id),
        claimRelations(id),
      ]);
      return asText({
        id,
        text: claim.text,
        modality: claim.modality,
        descriptors: claim.descriptors,
        evidence: receipts?.mentions ?? [],
        relations,
        challenges: receipts?.threads ?? [],
        disputeState: receipts?.state ?? "undisputed",
        receipt: receipts?.created ?? null,
        url: pageUrl(scope),
      });
    }
  );
}

function registerGetHypothesis(server: McpServer, scope: McpScope): void {
  server.registerTool(
    "get_hypothesis",
    {
      title: "Get a hypothesis with community credence",
      description:
        "One hypothesis with its linked claims (polarity + diagnosticity), the community's credence history, challenges, and receipts. Accepts ids with or without the hyp: prefix.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const bareId = id.startsWith("hyp:") ? id.slice(4) : id;
      const nodeId = `hyp:${bareId}`;
      if (!inScope(scope, nodeId)) {
        return notFound(scope, nodeId);
      }
      const [hypothesis] = await db
        .select()
        .from(schema.hypotheses)
        .where(eq(schema.hypotheses.id, bareId))
        .limit(1);
      if (!hypothesis) {
        return notFound(scope, nodeId);
      }
      const [links, credenceEntries, receipts] = await Promise.all([
        db
          .select()
          .from(schema.hypothesisLinks)
          .where(eq(schema.hypothesisLinks.hypothesisId, bareId)),
        listCredences([bareId]),
        getNodeReceipts(nodeId),
      ]);
      const claimIds = [...new Set(links.map((l) => l.claimId))];
      const texts =
        claimIds.length > 0
          ? await db
              .select({
                canonicalId: schema.claims.canonicalId,
                text: schema.claims.text,
              })
              .from(schema.claims)
              .where(inArray(schema.claims.canonicalId, claimIds))
          : [];
      const textOf = new Map(texts.map((t) => [t.canonicalId, t.text]));
      const credence = summarizeCredences(credenceEntries).get(bareId) ?? null;
      return asText({
        id: nodeId,
        statement: hypothesis.statement,
        answerBearing: hypothesis.answerBearing,
        status: hypothesis.status,
        linkedClaims: links.map((l) => ({
          claimId: l.claimId,
          text: clip(textOf.get(l.claimId) ?? ""),
          polarity: l.polarity,
          diagnosticity: l.diagnosticity,
        })),
        communityCredence: credence,
        challenges: receipts?.threads ?? [],
        receipt: receipts?.created ?? null,
        url: pageUrl(scope),
      });
    }
  );
}

// ── topics ───────────────────────────────────────────────────────────────────

async function topicOverview(scope: McpScope, slug: string) {
  const resolved = await resolveTopicSlice(slug);
  if (!resolved) {
    return asText({ error: `unknown topic "${slug}"` });
  }
  const { topic, graph } = resolved;
  const contributors = new Set(
    Object.values(graph.provenance).map((p) => p.contributorId)
  );
  return asText({
    slug: topic.slug,
    name: topic.name,
    description: topic.description,
    seedQuery: topic.seedQuery,
    createdAt: topic.createdAt,
    counts: { ...graph.counts, contributors: contributors.size },
    hypotheses: graph.assessment.hypotheses,
    topClaims: graph.nodes
      .filter((n) => n.kind === "claim")
      .slice(0, TOP_CLAIMS)
      .map((n) => ({ id: n.id, text: clip(n.label) })),
    url: `${scope.origin}/topics/${topic.slug}`,
  });
}

function registerTopicTools(server: McpServer, scope: McpScope): void {
  if (scope.topic) {
    const slug = scope.topic.slug;
    server.registerTool(
      "get_topic",
      {
        title: "Get this topic's overview",
        description:
          "Overview of this topic slice: counts, hypotheses with support/credence, and its top claims — a good first call to orient.",
        inputSchema: {},
      },
      () => topicOverview(scope, slug)
    );
    return;
  }
  server.registerTool(
    "get_topic",
    {
      title: "Get a topic's overview",
      description:
        "Overview of one published topic slice: counts, hypotheses with support/credence, and its top claims.",
      inputSchema: { slug: z.string().min(1) },
    },
    ({ slug }) => topicOverview(scope, slug)
  );
  server.registerTool(
    "list_topics",
    {
      title: "List published topics",
      description:
        "All published topic slices of the commons, with stats, public page urls, and per-topic MCP connector urls.",
      inputSchema: {},
    },
    async () => {
      const topics = await listTopics();
      return asText({
        topics: topics.map((t) => ({
          slug: t.slug,
          name: t.name,
          description: t.description,
          stats: t.stats,
          url: `${scope.origin}/topics/${t.slug}`,
          mcpUrl: `${scope.origin}/api/mcp/${t.slug}/mcp`,
        })),
      });
    }
  );
}

// Releases are the frozen counterpart to topic slices: a topic answers "what
// does the commons say now", a release answers "what did it say at the moment
// this was cited". Shaped like topicOverview on purpose so a client can treat
// them interchangeably; topClaims is clipped for the same reason (the full
// frozen graph is far too large for a tool result).
function registerReleaseTools(server: McpServer, scope: McpScope): void {
  // Commons-wide, like list_topics: a release cuts across investigations, not
  // topic slices, so it has no scoped meaning on a per-topic connector.
  if (scope.topic) {
    return;
  }
  server.registerTool(
    "list_releases",
    {
      title: "List published releases",
      description:
        "Every citable release cut from the commons — frozen, versioned checkpoints of an investigation's graph, each with its public permalink.",
      inputSchema: {},
    },
    async () => {
      const releases = await listAllReleases();
      return asText({
        releases: releases.map((r) => ({
          id: r.id,
          title: r.title,
          version: r.version,
          name: r.name,
          notes: r.notes,
          cutoff: r.cutoff,
          creatorName: r.creatorName,
          url: `${scope.origin}/releases/${r.id}`,
        })),
      });
    }
  );
  server.registerTool(
    "get_release",
    {
      title: "Get a release's frozen graph",
      description:
        "One release as of its cut moment — counts, hypotheses with support/credence, top claims, and a ready-to-paste citation. Resolves identically forever.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const release = await getRelease(id);
      if (!release) {
        return asText({ error: `unknown release "${id}"` });
      }
      const { hops: _hops, ...record } = release;
      const graph = await releaseGraph(release);
      const contributors = new Set(
        Object.values(graph.provenance).map((p) => p.contributorId)
      );
      return asText({
        ...record,
        counts: { ...graph.counts, contributors: contributors.size },
        hypotheses: graph.assessment.hypotheses,
        topClaims: graph.nodes
          .filter((n) => n.kind === "claim")
          .slice(0, TOP_CLAIMS)
          .map((n) => ({ id: n.id, text: clip(n.label) })),
        citation: citationFor(record, scope.origin).plain,
        url: `${scope.origin}/releases/${record.id}`,
      });
    }
  );
}

export function registerCommonsTools(server: McpServer, scope: McpScope): void {
  registerSearchAndFetch(server, scope);
  registerGetClaim(server, scope);
  registerGetHypothesis(server, scope);
  registerTopicTools(server, scope);
  registerReleaseTools(server, scope);
}
