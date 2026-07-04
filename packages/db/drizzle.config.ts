import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Local Supabase default; overridden by DATABASE_URL when set.
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
  },
})
