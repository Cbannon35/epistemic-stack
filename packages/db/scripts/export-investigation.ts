/**
 * Export one investigation's commons subgraph to a portable JSON seed.
 *
 *   POSTGRES_URL=... bun packages/db/scripts/export-investigation.ts <sessionId> [outFile]
 *
 * The seed is scoped by the receipt spine: every `contribution` stamped with
 * this session, plus every domain row (claim / source / mention / relation /
 * crux / hypothesis / link / assessment) that FKs one of those contributions,
 * plus the contributors who made them and the investigation row itself. Claim
 * embeddings ARE included so dedup/search work the moment the seed is loaded.
 * Load it with load-seed.ts into any fresh commons.
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

const contributions = await db
  .select()
  .from(schema.contributions)
  .where(eq(schema.contributions.sessionId, sessionId))
const contributionIds = contributions.map((c) => c.id)
const contributorIds = [...new Set(contributions.map((c) => c.contributorId))]
// Empty guard: inArray([]) is a valid-but-always-false filter.
const inContrib = inArray(schema.sources.contributionId, contributionIds)

const [
  contributors,
  investigationTurns,
  sources,
  claims,
  mentions,
  relations,
  cruxes,
  hypotheses,
  hypothesisLinks,
  assessments,
] = await Promise.all([
  contributorIds.length
    ? db.select().from(schema.contributors).where(inArray(schema.contributors.id, contributorIds))
    : Promise.resolve([]),
  db
    .select()
    .from(schema.investigationTurns)
    .where(eq(schema.investigationTurns.sessionId, sessionId)),
  db.select().from(schema.sources).where(inContrib),
  db.select().from(schema.claims).where(inArray(schema.claims.contributionId, contributionIds)),
  db.select().from(schema.mentions).where(inArray(schema.mentions.contributionId, contributionIds)),
  db
    .select()
    .from(schema.relations)
    .where(inArray(schema.relations.contributionId, contributionIds)),
  db.select().from(schema.cruxes).where(inArray(schema.cruxes.contributionId, contributionIds)),
  db
    .select()
    .from(schema.hypotheses)
    .where(inArray(schema.hypotheses.contributionId, contributionIds)),
  db
    .select()
    .from(schema.hypothesisLinks)
    .where(inArray(schema.hypothesisLinks.contributionId, contributionIds)),
  db
    .select()
    .from(schema.assessments)
    .where(inArray(schema.assessments.contributionId, contributionIds)),
])

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
      hypothesisLinks: hypothesisLinks.length,
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
  hypothesisLinks,
  assessments,
  investigations,
  investigationTurns,
}

await Bun.write(outFile, JSON.stringify(seed, null, 2))
console.log(
  `wrote ${outFile} — ${claims.length} claims, ${sources.length} sources, ${hypotheses.length} hypotheses, ${hypothesisLinks.length} links`,
)
process.exit(0)
