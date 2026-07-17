import { NextResponse } from "next/server";
import { searchCommons } from "@/lib/commons-search";
import { getAncestorChain } from "@/lib/investigations";
import { createClient } from "@/lib/supabase/server";

// Cross-investigation search for the ⌘K dialog and the prior-work strip.
// ?q=<query>&exclude=<sessionId> — exclude drops the room's own fork lineage
// (that work is already in the asker's graph scope).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ hits: [] });
  }
  const exclude = url.searchParams.get("exclude");
  const mode = url.searchParams.get("mode") === "or" ? "or" : "and";
  const excludeLineage = exclude ? await getAncestorChain(exclude) : [];
  const hits = await searchCommons({
    query,
    mode,
    excludeLineage,
    limit: 12,
  });
  return NextResponse.json({ hits });
}
