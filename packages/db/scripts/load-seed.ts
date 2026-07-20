/**
 * Load a commons seed (produced by export-investigation.ts) into a database.
 *
 *   DATABASE_URL=... bun packages/db/scripts/load-seed.ts data/seeds/covid-lab-leak.json
 *
 * Idempotent: every insert is onConflictDoNothing, so re-running is a no-op and
 * loading a seed into a commons that already has some of these rows just fills
 * the gaps (content-addressed claims/sources merge by id — the "many sources,
 * one claim" invariant works across seeds too). Tables are inserted in FK order.
 */
import { createDb, schema } from '../src/index.ts'

const file = process.argv[2]
if (!file) {
  console.error('usage: load-seed.ts <seed.json>')
  process.exit(1)
}

// Timestamp columns come back as ISO strings in JSON; drizzle's date-mode
// timestamp columns want Date objects on insert. Revive anything shaped like a
// full ISO-8601 instant (no domain string collides with that pattern).
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const seed = JSON.parse(await Bun.file(file).text(), (_k, v) =>
  typeof v === 'string' && ISO.test(v) ? new Date(v) : v,
) as Record<string, unknown[]>

const db = createDb()

// Insert order = FK order (parents first).
const order: Array<[string, keyof typeof schema]> = [
  ['contributors', 'contributors'],
  ['investigations', 'investigations'],
  ['contributions', 'contributions'],
  ['sources', 'sources'],
  ['claims', 'claims'],
  ['hypotheses', 'hypotheses'],
  ['mentions', 'mentions'],
  ['relations', 'relations'],
  ['cruxes', 'cruxes'],
  ['hypothesisLinks', 'hypothesisLinks'],
  ['assessments', 'assessments'],
  ['investigationTurns', 'investigationTurns'],
]

if (seed.meta) {
  const m = seed.meta as unknown as { title?: string }
  console.log(`loading seed: "${m.title ?? file}"`)
}

for (const [key, tableName] of order) {
  const rows = (seed[key] as Record<string, unknown>[] | undefined) ?? []
  if (rows.length === 0) {
    continue
  }
  const table = schema[tableName] as Parameters<typeof db.insert>[0]
  // Chunk to keep parameter counts under Postgres' limit on wide tables.
  const CHUNK = 200
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    await db.insert(table).values(batch).onConflictDoNothing()
    inserted += batch.length
  }
  console.log(`  ${key}: ${inserted} rows`)
}

console.log('done.')
process.exit(0)
