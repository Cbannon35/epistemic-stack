"use server";

import type { BeliefComparison, ContributorStats } from "@/lib/people";
import { compareBeliefs, getContributorStats } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getPersonStats(
  contributorId: string
): Promise<ContributorStats | null> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  return getContributorStats(contributorId);
}

// "Where do we disagree?" — my latest credences vs theirs, widest gap first.
export async function getBeliefComparison(
  otherContributorId: string
): Promise<BeliefComparison | null> {
  const user = await requireUser();
  if (!user || user.id === otherContributorId) {
    return null;
  }
  return compareBeliefs(user.id, otherContributorId);
}
