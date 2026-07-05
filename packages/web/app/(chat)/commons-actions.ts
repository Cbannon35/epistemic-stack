"use server";

import { formatCommonsDigest, searchCommons } from "@/lib/commons-search";
import { getAncestorChain } from "@/lib/investigations";
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
  if (!user || !input.query.trim()) {
    return null;
  }
  const excludeSessionIds = input.excludeSessionId
    ? await getAncestorChain(input.excludeSessionId)
    : [];
  const hits = await searchCommons({
    query: input.query,
    mode: "or",
    kinds: ["claim", "hypothesis"],
    excludeSessionIds,
    limit: 8,
  });
  return formatCommonsDigest(hits);
}
