"use server";

import { ensureContributor } from "@/lib/contributors";
import { recordCredence } from "@/lib/credences";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Register the signed-in user's credence on a hypothesis (0–100 from the UI).
// The write inserts a contribution row, so the graph panel's postgres_changes
// subscription repaints every member's view — no extra broadcast needed.
export async function submitCredence(input: {
  hypothesisId: string;
  value: number;
  note?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!user) {
    return { ok: false, error: "not signed in" };
  }
  if (!Number.isFinite(input.value)) {
    return { ok: false, error: "invalid credence" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  return recordCredence({
    hypothesisId: input.hypothesisId,
    contributorId: user.id,
    value: input.value,
    note: input.note ?? null,
    sessionId: input.sessionId ?? null,
  });
}
