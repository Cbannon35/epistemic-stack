import "server-only";
import { createDb } from "@epistack/db";
import { sql } from "drizzle-orm";
import {
  getAncestorChain,
  hopSessionIds,
  type LineageHop,
} from "@/lib/investigations";

// Cross-investigation retrieval — the compounding read path. Full-text search
// (not vectors): only claims carry embeddings, and embedding a query would pull
// the transformers/onnx stack into the Next server (the agent host loads it;
// the web server deliberately never does — see lib/comments.ts). At commons
// scale a ranked seq scan is fine; GIN expression indexes are the upgrade path.

const db = createDb();

export type CommonsHitKind = "claim" | "hypothesis" | "crux" | "source";

export type CommonsHit = {
  /** Graph node id (crux:/hyp: prefixed, matching /api/graph). */
  nodeId: string;
  kind: CommonsHitKind;
  text: string;
  rank: number;
  /** Originating investigation (null for writes outside any room). */
  investigationId: string | null;
  investigationTitle: string | null;
  contributorName: string | null;
  createdAt: string | null;
};

// "and": websearch semantics for short keyword queries (the ⌘K dialog).
// "or": every term optional, ranked — question-shaped queries (eve seeding)
// would AND eight terms together and match nothing.
export type CommonsSearchMode = "and" | "or";

function tsquery(query: string, mode: CommonsSearchMode) {
  if (mode === "and") {
    return sql`websearch_to_tsquery('english', ${query})`;
  }
  // plainto_tsquery ANDs lexemes; rewriting & → | relaxes it to OR. An
  // all-stopword query yields an empty tsquery, which matches nothing (no error).
  return sql`replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery`;
}

type KindSpec = {
  kind: CommonsHitKind;
  /** SQL for the searchable text. */
  document: ReturnType<typeof sql>;
  /** SQL for the graph node id. */
  nodeId: ReturnType<typeof sql>;
  table: ReturnType<typeof sql>;
  contributionId: ReturnType<typeof sql>;
};

const KINDS: KindSpec[] = [
  {
    kind: "claim",
    document: sql`t.text`,
    nodeId: sql`t.canonical_id`,
    table: sql`claims`,
    contributionId: sql`t.contribution_id`,
  },
  {
    kind: "hypothesis",
    document: sql`t.statement`,
    nodeId: sql`'hyp:' || t.id::text`,
    table: sql`hypotheses`,
    contributionId: sql`t.contribution_id`,
  },
  {
    kind: "crux",
    document: sql`t.question`,
    nodeId: sql`'crux:' || t.id::text`,
    table: sql`cruxes`,
    contributionId: sql`t.contribution_id`,
  },
  {
    kind: "source",
    document: sql`coalesce(t.title, '') || ' ' || coalesce(t.author, '') || ' ' || coalesce(t.publisher, '')`,
    nodeId: sql`t.id`,
    table: sql`sources`,
    contributionId: sql`t.contribution_id`,
  },
];

export async function searchCommons(input: {
  query: string;
  mode?: CommonsSearchMode;
  kinds?: CommonsHitKind[];
  /** Lineage hops to skip — the asking room's fork-ancestor chain. Each hop
   * is time-bounded: an ancestor's writes AFTER the fork moment are genuinely
   * other work and should surface as cross-investigation hits. */
  excludeLineage?: LineageHop[];
  limit?: number;
}): Promise<CommonsHit[]> {
  const query = input.query.trim().slice(0, 400);
  if (!query) {
    return [];
  }
  const mode = input.mode ?? "and";
  const wanted = new Set(input.kinds ?? KINDS.map((k) => k.kind));
  const exclude = input.excludeLineage ?? [];
  const limit = Math.min(input.limit ?? 12, 40);

  const q = tsquery(query, mode);
  // Writes within the room's own fork lineage (up to each hop's cutoff) are
  // already in its graph scope — only those are excluded here.
  const hopSql = (hop: LineageHop) => {
    const ids = sql.join(
      hopSessionIds(hop).map((id) => sql`${id}`),
      sql`, `
    );
    return hop.cutoff == null
      ? sql`(c.session_id in (${ids}))`
      : sql`(c.session_id in (${ids}) and c.created_at <= ${new Date(hop.cutoff)})`;
  };
  const excludeSql =
    exclude.length > 0
      ? sql`and (c.session_id is null or not (${sql.join(
          exclude.map(hopSql),
          sql` or `
        )}))`
      : sql``;

  const perKind = await Promise.all(
    KINDS.filter((k) => wanted.has(k.kind)).map(async (spec) => {
      const rows = await db.execute<{
        node_id: string;
        text: string;
        rank: number;
        investigation_id: string | null;
        investigation_title: string | null;
        contributor_name: string | null;
        created_at: string | Date | null;
      }>(sql`
        select
          ${spec.nodeId} as node_id,
          ${spec.document} as text,
          ts_rank(to_tsvector('english', ${spec.document}), ${q}) as rank,
          c.session_id as investigation_id,
          i.title as investigation_title,
          p.display_name as contributor_name,
          c.created_at as created_at
        from ${spec.table} t
        left join contributions c on c.id = ${spec.contributionId}
        left join investigations i on i.id = c.session_id
        left join contributors p on p.id = c.contributor_id
        where to_tsvector('english', ${spec.document}) @@ ${q}
          ${excludeSql}
        order by rank desc
        limit ${limit}
      `);
      return [...rows].map(
        (r): CommonsHit => ({
          nodeId: r.node_id,
          kind: spec.kind,
          text: r.text,
          rank: Number(r.rank),
          investigationId: r.investigation_id,
          investigationTitle: r.investigation_title,
          contributorName: r.contributor_name,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        })
      );
    })
  );

  return perKind
    .flat()
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}

const DIGEST_LIMIT = 1500;

// The one-turn seed for eve: what OTHER investigations already established,
// formatted for clientContext. Claims + hypotheses only — those are citable;
// raw sources would spend the budget without asserting anything.
export function formatCommonsDigest(hits: CommonsHit[]): string | null {
  const usable = hits.filter(
    (h) => h.kind === "claim" || h.kind === "hypothesis"
  );
  if (usable.length === 0) {
    return null;
  }
  const header =
    "Relevant prior work already in the shared commons (from OTHER investigations — treat as established starting points, cite the originating investigation, and use query_commons to pull details before re-researching):";
  const lines: string[] = [];
  let length = header.length;
  for (const hit of usable) {
    const origin = hit.investigationTitle
      ? `investigation "${hit.investigationTitle.slice(0, 80)}"${hit.contributorName ? ` (${hit.contributorName})` : ""}`
      : "the shared commons";
    const line = `- [${hit.kind}] "${hit.text.slice(0, 220)}" — from ${origin}`;
    if (length + line.length > DIGEST_LIMIT) {
      break;
    }
    lines.push(line);
    length += line.length;
  }
  if (lines.length === 0) {
    return null;
  }
  return `${header}\n${lines.join("\n")}`;
}

// One seed recipe for every sender — the browser composer and the agent MCP
// send path call THIS, so their commons seeding can't drift.
export async function buildCommonsSeed(
  query: string,
  excludeSessionId: string | null
): Promise<string | null> {
  if (!query.trim()) {
    return null;
  }
  const excludeLineage = excludeSessionId
    ? await getAncestorChain(excludeSessionId)
    : [];
  const hits = await searchCommons({
    query,
    mode: "or",
    kinds: ["claim", "hypothesis"],
    excludeLineage,
    limit: 8,
  });
  return formatCommonsDigest(hits);
}
