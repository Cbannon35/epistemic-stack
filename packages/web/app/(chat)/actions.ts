"use server";

import { ensureContributor } from "@/lib/contributors";
import {
  getInvestigation,
  saveInvestigationSession,
  upsertInvestigation,
} from "@/lib/investigations";
import { createClient } from "@/lib/supabase/server";

// Called from the client on each turn finish: upsert the investigation (keyed by
// the eve session id, titled by the question) and save its session snapshot for
// resume. Attributed to the signed-in user.
export async function saveInvestigation(input: {
  sessionId: string;
  title: string;
  sessionState: unknown;
  events: unknown;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }
  await ensureContributor(user.id, user.email ?? user.id);
  await upsertInvestigation({
    id: input.sessionId,
    contributorId: user.id,
    title: input.title.slice(0, 200),
  });
  await saveInvestigationSession({
    id: input.sessionId,
    sessionState: input.sessionState,
    events: input.events,
    updatedAt: new Date(),
  });
}

// Load a saved investigation's eve session snapshot so the client can resume it
// (restores the transcript via initialSession/initialEvents). Only the owner.
export async function getInvestigationSession(
  id: string
): Promise<{ session: unknown; events: unknown } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const inv = await getInvestigation(id);
  if (!inv || inv.contributorId !== user.id) {
    return null;
  }
  return { session: inv.sessionState, events: inv.events };
}
