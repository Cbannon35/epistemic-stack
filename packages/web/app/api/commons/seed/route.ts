import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDb, loadSeed, loadSession, parseSeed } from "@epistack/db";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Load a bundled seed — the commons graph AND, if present, eve's chat session —
// in one shot.
//   GET  → list seeds (name, title, counts, hasChat)
//   POST { name } → load graph + chat (auth required); returns the sessionId so
//                   the client can open the room with the transcript replaying.
// A seed's files in data/seeds/: <name>.json (graph, epistack-commons-seed@1)
// and optional <name>.session.json (chat). Other .json files are ignored.

const SEED_DIRS = [
  join(process.cwd(), "..", "..", "data", "seeds"),
  join(process.cwd(), "data", "seeds"),
];
const NAME_RE = /^[a-z0-9-]+$/;

async function seedDir(): Promise<string | null> {
  for (const dir of SEED_DIRS) {
    try {
      await readdir(dir);
      return dir;
    } catch {
      // try next
    }
  }
  return null;
}

// A graph seed is a *.json whose meta marks it a commons seed (this filters out
// the .session.json chat dumps and the plain transcript files).
async function readGraphSeed(
  dir: string,
  file: string
): Promise<{
  name: string;
  title: string;
  counts: Record<string, number> | null;
  sessionId: string | null;
} | null> {
  if (
    !file.endsWith(".json") ||
    file.endsWith(".session.json") ||
    file.endsWith(".transcript.json")
  ) {
    return null;
  }
  try {
    const meta = (
      JSON.parse(await readFile(join(dir, file), "utf8")) as {
        meta?: {
          format?: string;
          title?: string;
          sessionId?: string;
          counts?: Record<string, number>;
        };
      }
    ).meta;
    if (!meta?.format?.startsWith("epistack-commons-seed")) {
      return null;
    }
    return {
      name: file.replace(/\.json$/, ""),
      title: meta.title ?? file,
      counts: meta.counts ?? null,
      sessionId: meta.sessionId ?? null,
    };
  } catch {
    return null;
  }
}

async function hasChat(dir: string, name: string): Promise<boolean> {
  try {
    await readFile(join(dir, `${name}.session.json`), "utf8");
    return true;
  } catch {
    return false;
  }
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
  const files = await readdir(dir);
  const seeds = (
    await Promise.all(
      files.map(async (file) => {
        const seed = await readGraphSeed(dir, file);
        if (!seed) {
          return null;
        }
        return { ...seed, hasChat: await hasChat(dir, seed.name) };
      })
    )
  ).filter((s) => s !== null);
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
  let graphText: string;
  try {
    graphText = await readFile(join(dir, `${name}.json`), "utf8");
  } catch {
    return NextResponse.json({ error: "seed not found" }, { status: 404 });
  }
  try {
    const db = createDb();
    const graph = parseSeed(graphText);
    await loadSeed(db, graph);
    const sessionId =
      (graph.meta as { sessionId?: string } | undefined)?.sessionId ?? null;

    // Load the chat session too, if the seed ships one.
    let chat = false;
    try {
      const sessionText = await readFile(
        join(dir, `${name}.session.json`),
        "utf8"
      );
      await loadSession(db, JSON.parse(sessionText));
      chat = true;
    } catch {
      // no session file (or unreadable) — graph-only load
    }
    return NextResponse.json({ ok: true, sessionId, chat });
  } catch (error) {
    console.error("[seed] load failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "load failed" },
      { status: 500 }
    );
  }
}
