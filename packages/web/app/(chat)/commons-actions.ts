"use server";

import { buildCommonsSeed } from "@/lib/commons-search";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Cross-investigation seeding for a turn: what OTHER investigations already
// established that bears on this question, as a bounded clientContext digest.
// Question-shaped queries use OR matching — websearch AND semantics over eight
// words would return nothing. Best-effort: callers treat null as "no seed".
export async function getCommonsSendContext(input: {
  query: string;
  excludeSessionId: string | null;
}): Promise<string | null> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  return await buildCommonsSeed(input.query, input.excludeSessionId);
}
