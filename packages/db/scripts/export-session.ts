/**
 * Export an eve chat SESSION (the durable workflow stream — the transcript that
 * replays in the app) to JSON. Separate from the commons graph export: the chat
 * lives in eve's @workflow/world-postgres store (the `workflow` schema), not the
 * commons tables.
 *
 *   DATABASE_URL=... bun packages/db/scripts/export-session.ts <sessionId> [outFile]
 *
 * Dumps every workflow_* row for the session's runs (the entry run whose id IS
 * the session id, plus its turn runs). Binary (bytea/cbor) columns hold the
 * actual event payloads and streamed text, so they're base64-encoded. Load with
 * load-session.ts into a fresh workflow store to make the chat replayable.
 */
import { createDb } from '../src/index.ts'

const sessionId = process.argv[2]
const outFile = process.argv[3] ?? `data/seeds/${sessionId}.session.json`
if (!sessionId) {
  console.error('usage: export-session.ts <sessionId> [outFile]')
  process.exit(1)
}

const db = createDb()
const raw = (sql: string) => db.execute(sql) as unknown as Promise<Record<string, unknown>[]>
const q = (s: string) => s.replace(/'/g, "''")

// A session = its entry run (id === sessionId) + its turn runs. eve stores no
// queryable parent link (execution_context is null), but a session's runs share
// a ULID prefix: `wrun_` + the 8 high timestamp chars — entry and turn are minted
// within the same ~256ms window, while separate investigations (minted seconds+
// apart) differ earlier. Scope by that 13-char prefix so a multi-session store
// exports only THIS session's runs.
const runPrefix = sessionId.slice(0, 13)
const runRows = await raw(`select id from workflow.workflow_runs where id like '${q(runPrefix)}%'`)
const runIds: string[] = runRows.map((r) => r.id as string)
if (!runIds.includes(sessionId)) {
  console.error(`no entry workflow run with id ${sessionId}`)
  process.exit(1)
}
const inRuns = runIds.map((id) => `'${q(id)}'`).join(',')

// bytea columns come back as Uint8Array/Buffer — tag+base64 them for JSON.
function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
      out[k] = { __bytea: Buffer.from(v as Uint8Array).toString('base64') }
    } else {
      out[k] = v
    }
  }
  return out
}

const TABLES = [
  ['workflow_runs', 'id'],
  ['workflow_events', 'run_id'],
  ['workflow_steps', 'run_id'],
  ['workflow_stream_chunks', 'run_id'],
  ['workflow_hooks', 'run_id'],
  ['workflow_waits', 'run_id'],
] as const

const session: Record<string, unknown> = {
  meta: {
    format: 'epistack-session@1',
    sessionId,
    runIds,
    exportedAt: new Date().toISOString(),
  },
}
const counts: Record<string, number> = {}
for (const [table, key] of TABLES) {
  const rows = await raw(`select * from workflow."${table}" where "${key}" in (${inRuns})`)
  session[table] = rows.map(encodeRow)
  counts[table] = rows.length
}
;(session.meta as Record<string, unknown>).counts = counts

await Bun.write(outFile, JSON.stringify(session, null, 2))
console.log(`wrote ${outFile} —`, JSON.stringify(counts))
process.exit(0)
