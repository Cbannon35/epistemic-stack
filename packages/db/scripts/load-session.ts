/**
 * Load an eve chat session (produced by export-session.ts) into the workflow
 * store so the transcript replays in the app.
 *
 *   DATABASE_URL=... bun packages/db/scripts/load-session.ts data/seeds/covid-lab-leak.session.json
 *
 * Idempotent (onConflictDoNothing). Inserts workflow_runs first (the rest FK
 * run_id), decoding base64 bytea columns back to Buffers. Best loaded into a
 * fresh workflow store dedicated to the seed it accompanies.
 *
 * Caveat: the entry run is exported with whatever status it had (often
 * "running", since eve sessions stay open for more turns). On a fresh store the
 * eve worker may try to resume it; the transcript still replays read-only via
 * the session stream either way.
 */
import { sql } from 'drizzle-orm'
import { createDb } from '../src/index.ts'

const file = process.argv[2]
if (!file) {
  console.error('usage: load-session.ts <session.json>')
  process.exit(1)
}
const seed = JSON.parse(await Bun.file(file).text()) as Record<string, unknown>
const db = createDb()

type Bytea = { __bytea: string }
const isBytea = (v: unknown): v is Bytea => typeof v === 'object' && v !== null && '__bytea' in v

// Insert order = FK order (everything references workflow_runs.run_id).
const ORDER = [
  'workflow_runs',
  'workflow_events',
  'workflow_steps',
  'workflow_stream_chunks',
  'workflow_hooks',
  'workflow_waits',
]

for (const table of ORDER) {
  const rows = (seed[table] as Record<string, unknown>[] | undefined) ?? []
  if (rows.length === 0) {
    continue
  }
  for (const row of rows) {
    const cols = Object.keys(row)
    const colSql = sql.join(
      cols.map((c) => sql.identifier(c)),
      sql`, `,
    )
    const valSql = sql.join(
      cols.map((c) => {
        const v = row[c]
        if (isBytea(v)) {
          return sql`${Buffer.from(v.__bytea, 'base64')}`
        }
        // Non-null objects/arrays are jsonb columns — stringify + cast.
        if (v !== null && typeof v === 'object') {
          return sql`${JSON.stringify(v)}::jsonb`
        }
        return sql`${v}`
      }),
      sql`, `,
    )
    await db.execute(
      sql`insert into workflow.${sql.raw(`"${table}"`)} (${colSql}) values (${valSql}) on conflict do nothing`,
    )
  }
  console.log(`  ${table}: ${rows.length} rows`)
}
console.log('done.')
process.exit(0)
