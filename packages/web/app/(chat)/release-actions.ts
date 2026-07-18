"use server";

import { ensureContributor } from "@/lib/contributors";
import { type CutReleaseResult, cutRelease } from "@/lib/releases";
import { getAuthUser } from "@/lib/supabase/server";

// Cutting a release is open to any signed-in contributor: it is a pure
// addition, and the createdBy receipt carries the accountability.

export async function cutReleaseAction(input: {
  investigationId: string;
  name?: string | null;
  notes?: string | null;
}): Promise<CutReleaseResult> {
  const user = await getAuthUser();
  if (!user) {
    return { error: "sign in to cut a release" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  return await cutRelease({
    investigationId: input.investigationId,
    userId: user.id,
    name: input.name,
    notes: input.notes,
  });
}
