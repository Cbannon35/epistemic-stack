import { NextResponse } from "next/server";
import { ensureContributor } from "@/lib/contributors";
import { listDelegations, startDelegation } from "@/lib/delegate/run";
import { createClient } from "@/lib/supabase/server";

// Delegated eve investigations.
// POST: start a run — plans it (one model call) and returns the first beats;
//       the delegating client then drives /api/delegate/step until done.
// GET:  ?investigation=<id> — recent delegations for the dock (late joiners).

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    brief?: string;
  } | null;
  const sessionId = body?.sessionId;
  const brief = body?.brief?.trim();
  if (!(sessionId && brief)) {
    return NextResponse.json(
      { error: "sessionId and brief required" },
      { status: 400 }
    );
  }
  await ensureContributor(user.id, user.email ?? user.id);
  try {
    const advance = await startDelegation({
      sessionId,
      delegatorId: user.id,
      brief,
    });
    return NextResponse.json(advance);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "delegation failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const investigation = new URL(request.url).searchParams.get("investigation");
  if (!investigation) {
    return NextResponse.json(
      { error: "investigation required" },
      { status: 400 }
    );
  }
  return NextResponse.json({
    delegations: await listDelegations(investigation),
  });
}
