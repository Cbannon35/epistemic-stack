/**
 * Load a commons seed (produced by export-investigation.ts) into a database.
 *
 *   DATABASE_URL=... bun packages/db/scripts/load-seed.ts data/seeds/covid-lab-leak.json
 *
 * Idempotent: every insert is onConflictDoNothing, so re-running is a no-op and
 * loading a seed into a commons that already has some of these rows just fills
 * the gaps (content-addressed claims/sources merge by id). The actual insert
 * logic lives in ../src/seed.ts, shared with the web loader route.
 */
import { createDb, loadSeed, parseSeed } from '../src/index.ts'

const file = process.argv[2]
if (!file) {
  console.error('usage: load-seed.ts <seed.json>')
  process.exit(1)
}

const seed = parseSeed(await Bun.file(file).text())
console.log(`loading seed: "${seed.meta?.title ?? file}"`)

const counts = await loadSeed(createDb(), seed)
for (const [key, n] of Object.entries(counts)) {
  console.log(`  ${key}: ${n} rows`)
}
console.log('done.')
process.exit(0)
