import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * as schema from './schema'

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres'

type DrizzleDb = ReturnType<typeof makeDb>

function makeDb(url: string) {
  // Small pool that sheds idle connections fast: many callers share one client
  // (see cache below), and the local Supabase Postgres has ~100 slots shared
  // with eve's workflow world — a dev-mode leak here starves everything.
  const client = postgres(url, { prepare: false, max: 6, idle_timeout: 30 })
  return drizzle(client, { schema })
}

// One client per URL per process, cached on globalThis so Next.js dev-mode
// hot reloads reuse the pool instead of leaking connections until Postgres
// runs out of slots.
const globalCache = globalThis as unknown as {
  __epistackDb?: Map<string, DrizzleDb>
}

/** Get the shared Drizzle client for the local Supabase Postgres (or DATABASE_URL). */
export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_URL): DrizzleDb {
  globalCache.__epistackDb ??= new Map()
  const cache = globalCache.__epistackDb
  let db = cache.get(url)
  if (!db) {
    db = makeDb(url)
    cache.set(url, db)
  }
  return db
}

export type Db = DrizzleDb
