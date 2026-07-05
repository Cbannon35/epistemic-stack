import { NextResponse } from "next/server";
import { stepDelegation } from "@/lib/delegate/run";
import { createClient } from "@/lib/supabase/server";

// Advance a delegated run one phase (research → synthesize). Driven by the
// delegating client between narration beats; each call is at most one model
// call, and doubles as the run's heartbeat (updatedAt).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    delegationId?: string;
  } | null;
  const delegationId = body?.delegationId;
  if (!delegationId) {
    return NextResponse.json(
      { error: "delegationId required" },
      { status: 400 }
    );
  }
  try {
    const advance = await stepDelegation({
      delegationId,
      delegatorId: user.id,
    });
    return NextResponse.json(advance);
  } catch (error) {
    // Phase failures already marked the row inside stepDelegation.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "step failed" },
      { status: 500 }
    );
  }
}
