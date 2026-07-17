import { NextResponse } from "next/server";
import { getInvestigation, listTurnAuthors } from "@/lib/investigations";
import { createClient } from "@/lib/supabase/server";

// Room boot snapshot for joining an investigation. A plain GET (not a server
// action) because AppShell fetches it during render via use() — invoking a
// server action mid-render trips React's "setState while rendering" guard.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const inv = await getInvestigation(id);
  if (!inv) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    session: inv.sessionState,
    events: inv.events,
    title: inv.title,
    ownerId: inv.contributorId,
    forkedFrom: inv.forkedFrom,
    forkPreludeCount: inv.forkPreludeCount,
    seedFromCommons: inv.seedFromCommons,
    authors: await listTurnAuthors(id),
  });
}
