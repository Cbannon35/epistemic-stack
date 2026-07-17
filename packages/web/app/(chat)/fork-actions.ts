"use server";

import { ensureContributor } from "@/lib/contributors";
import {
  type DeleteForkResult,
  deleteFork,
  type ForkResult,
  forkInvestigation,
} from "@/lib/fork";
import { createClient } from "@/lib/supabase/server";

// Fork = a durable app-side branch (transcript prelude + authorship + comments
// + completed delegations). No commons rows are written — the fork inherits
// ancestor claims via time-bounded lineage scope.

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function forkInvestigationAction(input: {
  parentId: string;
  turnId: string;
}): Promise<ForkResult> {
  const user = await requireUser();
  if (!user) {
    return { error: "sign in to fork an investigation" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  return await forkInvestigation({
    parentId: input.parentId,
    turnId: input.turnId,
    userId: user.id,
  });
}

export async function deleteForkAction(input: {
  id: string;
}): Promise<DeleteForkResult> {
  const user = await requireUser();
  if (!user) {
    return { error: "sign in to delete a fork" };
  }
  return await deleteFork({ id: input.id, userId: user.id });
}
