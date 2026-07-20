import { sql } from 'drizzle-orm'
import type { Db } from './index'
import * as schema from './schema'

// Shared commons-seed loader — used by both the CLI (scripts/load-seed.ts) and
// the web route (app/api/commons/seed). Given a parsed seed object, inserts its
// rows in FK order, idempotently. The CLI reads the file with Bun, the route
// with node fs; both hand a parsed object here so this stays runtime-agnostic.

export type SeedCounts = Record<string, number>

export type CommonsSeed = {
  meta?: { format?: string; sessionId?: string; title?: string }
  [table: string]: unknown
}

// Timestamp columns serialize to ISO strings; drizzle's date-mode columns want
// Date objects on insert. Revive anything shaped like a full ISO-8601 instant
// (no domain string collides with that pattern).
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export function parseSeed(text: string): CommonsSeed {
  return JSON.parse(text, (_k, v) =>
    typeof v === 'string' && ISO.test(v) ? new Date(v) : v,
  ) as CommonsSeed
}

// Insert order = FK order (parents first). Each entry: seed key → schema table.
const LOAD_ORDER: Array<[string, keyof typeof schema]> = [
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

const CHUNK = 200

/**
 * Insert a seed's rows into the commons. Idempotent (onConflictDoNothing), so
 * re-loading is a no-op and loading into a populated commons just fills gaps —
 * content-addressed claims/sources merge by id. Returns per-table row counts.
 */
export async function loadSeed(db: Db, seed: CommonsSeed): Promise<SeedCounts> {
  const counts: SeedCounts = {}
  for (const [key, tableName] of LOAD_ORDER) {
    const rows = (seed[key] as Record<string, unknown>[] | undefined) ?? []
    if (rows.length === 0) {
      continue
    }
    // biome-ignore lint/performance/noDynamicNamespaceImportAccess: table dispatch by name is the point; server-side loader, not bundled client code
    const table = schema[tableName] as Parameters<typeof db.insert>[0]
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(table)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoNothing()
    }
    counts[key] = rows.length
  }
  return counts
}

// ── eve chat session (the workflow store — the replayable transcript) ────────

export type CommonsSession = Record<string, unknown>

type SessionBytea = { __bytea: string }
const isBytea = (v: unknown): v is SessionBytea =>
  typeof v === 'object' && v !== null && '__bytea' in v

// FK order: everything references workflow_runs.run_id.
const SESSION_TABLES = [
  'workflow_runs',
  'workflow_events',
  'workflow_steps',
  'workflow_stream_chunks',
  'workflow_hooks',
  'workflow_waits',
]

/**
 * Insert an eve chat session (from export-session.ts) into the workflow store
 * so the transcript replays. Idempotent. base64 bytea → Buffer; non-null
 * objects → jsonb. Dynamic columns per table, so this uses raw sql inserts.
 */
export async function loadSession(db: Db, session: CommonsSession): Promise<SeedCounts> {
  const counts: SeedCounts = {}
  for (const table of SESSION_TABLES) {
    const rows = (session[table] as Record<string, unknown>[] | undefined) ?? []
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
    counts[table] = rows.length
  }
  return counts
}
