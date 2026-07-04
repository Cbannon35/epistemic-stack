import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * as schema from './schema'

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres'

/** Create a Drizzle client bound to the local Supabase Postgres (or DATABASE_URL). */
export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_URL) {
  const client = postgres(url, { prepare: false })
  return drizzle(client, { schema })
}

export type Db = ReturnType<typeof createDb>
