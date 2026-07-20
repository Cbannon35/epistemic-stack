import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDb, loadSeed, parseSeed } from "@epistack/db";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Load a bundled commons seed into the live database.
//   GET  → list available seeds (name, title, counts)
//   POST { name } → load that seed (auth required); returns inserted counts.
// Seeds are the JSON files in the repo's data/seeds/ — the same files
// packages/db/scripts/load-seed.ts loads from the CLI, shared loader.

// The dev server runs from packages/web; the repo root is two up. Probe both
// so this survives being launched from the repo root too.
const SEED_DIRS = [
  join(process.cwd(), "..", "..", "data", "seeds"),
  join(process.cwd(), "data", "seeds"),
];

// Basename allowlist — no path traversal, no reading outside data/seeds.
const NAME_RE = /^[a-z0-9-]+$/;

async function seedDir(): Promise<string | null> {
  for (const dir of SEED_DIRS) {
    try {
      await readdir(dir);
      return dir;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const dir = await seedDir();
  if (!dir) {
    return NextResponse.json({ seeds: [] });
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const seeds = await Promise.all(
    files.map(async (file) => {
      const name = file.replace(/\.json$/, "");
      try {
        const raw = await readFile(join(dir, file), "utf8");
        const meta = (JSON.parse(raw) as { meta?: unknown }).meta as
          | { title?: string; counts?: Record<string, number> }
          | undefined;
        return {
          name,
          title: meta?.title ?? name,
          counts: meta?.counts ?? null,
        };
      } catch {
        return { name, title: name, counts: null };
      }
    })
  );
  return NextResponse.json({ seeds });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: string;
  } | null;
  const name = body?.name;
  if (!(name && NAME_RE.test(name))) {
    return NextResponse.json({ error: "invalid seed name" }, { status: 400 });
  }
  const dir = await seedDir();
  if (!dir) {
    return NextResponse.json({ error: "no seeds available" }, { status: 404 });
  }
  let text: string;
  try {
    text = await readFile(join(dir, `${name}.json`), "utf8");
  } catch {
    return NextResponse.json({ error: "seed not found" }, { status: 404 });
  }
  try {
    const counts = await loadSeed(createDb(), parseSeed(text));
    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    console.error("[seed] load failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "load failed" },
      { status: 500 }
    );
  }
}
