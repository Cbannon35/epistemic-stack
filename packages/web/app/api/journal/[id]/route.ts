import { NextResponse } from "next/server";
import { buildJournal } from "@/lib/journal";
import { createClient } from "@/lib/supabase/server";

// The full trail of one investigation: every question, eve's reasoning, each
// tool call, every answer, and delegated runs. Assembled read-only from the
// durable session snapshot + delegations table. Auth-gated like the room route.
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
  const journal = await buildJournal(id);
  if (!journal) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(journal);
}
