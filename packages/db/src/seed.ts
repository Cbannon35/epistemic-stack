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
