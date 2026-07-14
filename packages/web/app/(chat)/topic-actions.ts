"use server";

import { ensureContributor } from "@/lib/contributors";
import { createClient } from "@/lib/supabase/server";
import { createTopic, previewTopicSlice, type TopicStats } from "@/lib/topics";

// Publishing a topic writes an app-side row only (the slice recipe) — the
// graph content it exposes already carries its own commons receipts.

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function publishTopicAction(input: {
  name: string;
  description: string;
  seedQuery: string;
  pinnedClaimIds?: string[];
}): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!user) {
    return { ok: false, error: "sign in to publish a topic" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  const result = await createTopic({
    name: input.name,
    description: input.description.trim() || null,
    seedQuery: input.seedQuery,
    pinnedClaimIds: input.pinnedClaimIds,
    creatorId: user.id,
  });
  if ("error" in result) {
    return { ok: false, error: result.error };
  }
  return { ok: true, slug: result.slug };
}

/** Live dialog preview: what would this recipe capture right now? */
export async function previewTopicAction(
  seedQuery: string,
  pinnedClaimIds?: string[]
): Promise<{ ok: boolean; stats?: TopicStats }> {
  const user = await requireUser();
  if (!user || !seedQuery.trim()) {
    return { ok: false };
  }
  return {
    ok: true,
    stats: await previewTopicSlice(seedQuery, pinnedClaimIds),
  };
}
