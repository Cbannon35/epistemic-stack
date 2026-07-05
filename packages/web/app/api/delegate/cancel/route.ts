import { NextResponse } from "next/server";
import { cancelDelegation } from "@/lib/delegate/run";
import { createClient } from "@/lib/supabase/server";

// Cancel a running delegation. Only the delegator's cancel takes effect (the
// where-clause enforces it); the client also broadcasts delegation-end so
// every cursor disappears immediately.
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
  if (!body?.delegationId) {
    return NextResponse.json(
      { error: "delegationId required" },
      { status: 400 }
    );
  }
  await cancelDelegation({
    delegationId: body.delegationId,
    delegatorId: user.id,
  });
  return NextResponse.json({ ok: true });
}
