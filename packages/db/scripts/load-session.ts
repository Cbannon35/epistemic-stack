/**
 * Load an eve chat session (produced by export-session.ts) into the workflow
 * store so the transcript replays in the app.
 *
 *   DATABASE_URL=... bun packages/db/scripts/load-session.ts data/seeds/covid-lab-leak.session.json
 *
 * Idempotent. Insert logic lives in ../src/seed.ts (loadSession), shared with
 * the web loader route. Best loaded into a workflow store dedicated to the seed.
 */
import { createDb, loadSession } from '../src/index.ts'

const file = process.argv[2]
if (!file) {
  console.error('usage: load-session.ts <session.json>')
  process.exit(1)
}
const session = JSON.parse(await Bun.file(file).text())
const counts = await loadSession(createDb(), session)
for (const [t, n] of Object.entries(counts)) {
  console.log(`  ${t}: ${n} rows`)
}
console.log('done.')
process.exit(0)
