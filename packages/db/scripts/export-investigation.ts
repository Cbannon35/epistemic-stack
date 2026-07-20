/**
 * Export one investigation's commons subgraph to a portable JSON seed.
 *
 *   DATABASE_URL=... bun packages/db/scripts/export-investigation.ts <sessionId> [outFile]
 *
 * Scoping MIRRORS the app's graph builder (lib/graph-data.ts): the edges
 * (mentions / relations / cruxes / hypothesis-links / hypotheses / assessments)
 * stamped with this session are in scope, and the claim/source/hypothesis NODES
 * are whatever those edges reference — regardless of which session first created
 * them. This matters because claims are content-addressed and deduped globally:
 * a claim recorded elsewhere and re-confirmed here shows in this graph via its
 * mention, so the seed must include it too (the "many sources, one claim"
 * compounding — the whole point). Every contribution referenced by an exported
 * row is included (a superset of this session's contributions) so the seed is
 * FK-complete and loadable into a fresh commons. Claim embeddings are included.
 */
import { eq, inArray } from 'drizzle-orm'
import { createDb, schema } from '../src/index.ts'

const sessionId = process.argv[2]
const outFile = process.argv[3] ?? `data/seeds/${sessionId}.json`
if (!sessionId) {
  console.error('usage: export-investigation.ts <sessionId> [outFile]')
  process.exit(1)
}

const db = createDb()

const investigations = await db
  .select()
  .from(schema.investigations)
  .where(eq(schema.investigations.id, sessionId))
if (investigations.length === 0) {
  console.error(`no investigation with id ${sessionId}`)
  process.exit(1)
}

// The session's own receipts scope the EDGES.
const sessionContributions = await db
  .select()
  .from(schema.contributions)
  .where(eq(schema.contributions.sessionId, sessionId))
const sessionContribIds = sessionContributions.map((c) => c.id)

const idIn = <T>(col: T) => inArray(col as never, sessionContribIds)

const [mentions, relations, cruxes, hypLinksScoped, hypScoped, assessments] =
  sessionContribIds.length
    ? await Promise.all([
        db.select().from(schema.mentions).where(idIn(schema.mentions.contributionId)),
        db.select().from(schema.relations).where(idIn(schema.relations.contributionId)),
        db.select().from(schema.cruxes).where(idIn(schema.cruxes.contributionId)),
        db.select().from(schema.hypothesisLinks).where(idIn(schema.hypothesisLinks.contributionId)),
        db.select().from(schema.hypotheses).where(idIn(schema.hypotheses.contributionId)),
        db.select().from(schema.assessments).where(idIn(schema.assessments.contributionId)),
      ])
    : [[], [], [], [], [], []]

// NODE ids the edges reference (graph-data.ts §"claimIds"/"sourceIds").
const claimIds = new Set<string>()
const sourceIds = new Set<string>()
const hypIds = new Set<string>()
for (const m of mentions) {
  claimIds.add(m.claimId)
  sourceIds.add(m.sourceId)
}
for (const r of relations) {
  claimIds.add(r.fromClaimId)
  claimIds.add(r.toClaimId)
}
for (const x of cruxes) {
  if (x.claimId) {
    claimIds.add(x.claimId)
  }
}
for (const l of hypLinksScoped) {
  claimIds.add(l.claimId)
  hypIds.add(l.hypothesisId)
}
for (const h of hypScoped) {
  hypIds.add(h.id)
}

const idList = (s: Set<string>) => (s.size ? [...s] : ['\0none'])
const [claims, sources, hypotheses] = await Promise.all([
  db
    .select()
    .from(schema.claims)
    .where(inArray(schema.claims.canonicalId, idList(claimIds))),
  db
    .select()
    .from(schema.sources)
    .where(inArray(schema.sources.id, idList(sourceIds))),
  db
    .select()
    .from(schema.hypotheses)
    .where(inArray(schema.hypotheses.id, idList(hypIds))),
])

// FK closure: every contribution referenced by an exported row must ship, or
// the seed won't load. This is a SUPERSET of the session's contributions — it
// adds the foreign-session receipts that first created any merged-in claim.
const neededContribIds = new Set(sessionContribIds)
for (const row of [
  ...claims,
  ...sources,
  ...mentions,
  ...relations,
  ...cruxes,
  ...hypotheses,
  ...hypLinksScoped,
  ...assessments,
]) {
  const cid = (row as { contributionId?: string | null }).contributionId
  if (cid) {
    neededContribIds.add(cid)
  }
}
const contributions = await db
  .select()
  .from(schema.contributions)
  .where(inArray(schema.contributions.id, [...neededContribIds]))
const investigationTurns = await db
  .select()
  .from(schema.investigationTurns)
  .where(eq(schema.investigationTurns.sessionId, sessionId))

// Contributors referenced ANYWHERE the seed will insert: the receipts, the
// investigation row (contributor_id, notNull FK), and its turns. Missing any
// of these breaks the load into a fresh commons (contributors table empty).
const contributorIds = [
  ...new Set([
    ...contributions.map((c) => c.contributorId),
    ...investigations.map((i) => i.contributorId).filter((id) => id != null),
    ...investigationTurns.map((t) => t.contributorId).filter((id) => id != null),
  ]),
]
const contributorsRaw = contributorIds.length
  ? await db
      .select()
      .from(schema.contributors)
      .where(inArray(schema.contributors.id, contributorIds))
  : []
// These seeds ship to public repos — anonymize human identities. The agent
// (eve) keeps its name; the provenance shape ("asked by ‹someone›") survives.
const contributors = contributorsRaw.map((c) =>
  c.kind === 'human' ? { ...c, displayName: 'Anonymous', publicKey: null } : c,
)

const seed = {
  meta: {
    format: 'epistack-commons-seed@1',
    sessionId,
    title: investigations[0].title,
    exportedAt: new Date().toISOString(),
    counts: {
      contributions: contributions.length,
      claims: claims.length,
      sources: sources.length,
      mentions: mentions.length,
      relations: relations.length,
      cruxes: cruxes.length,
      hypotheses: hypotheses.length,
      hypothesisLinks: hypLinksScoped.length,
      assessments: assessments.length,
    },
  },
  // Insertion order = FK order; load-seed.ts replays it top to bottom.
  contributors,
  contributions,
  sources,
  claims,
  mentions,
  relations,
  cruxes,
  hypotheses,
  hypothesisLinks: hypLinksScoped,
  assessments,
  investigations,
  investigationTurns,
}

await Bun.write(outFile, JSON.stringify(seed, null, 2))
console.log(
  `wrote ${outFile} — ${claims.length} claims, ${sources.length} sources, ${hypotheses.length} hypotheses, ${hypLinksScoped.length} links, ${contributions.length} contributions`,
)
process.exit(0)
