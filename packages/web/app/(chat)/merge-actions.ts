"use server";

import { ensureContributor } from "@/lib/contributors";
import {
  type DecideMergeResult,
  decideMergeRequest,
  type OpenMergeResult,
  openMergeRequest,
  withdrawMergeRequest,
} from "@/lib/merge";
import { broadcastRoomEvent } from "@/lib/realtime/server-broadcast";
import type { MergeChangedEvent } from "@/lib/realtime/types";
import { getAuthUser } from "@/lib/supabase/server";

// Merge-request mutations. Every state change broadcasts `merge:changed` to
// BOTH rooms server-side — the actor's client is only ever in one of them.

async function notifyBothRooms(event: MergeChangedEvent): Promise<void> {
  await Promise.all([
    broadcastRoomEvent(event.sourceId, "merge:changed", event),
    broadcastRoomEvent(event.targetId, "merge:changed", event),
  ]);
}

export async function openMergeRequestAction(input: {
  sourceId: string;
  targetId: string;
  note?: string | null;
}): Promise<OpenMergeResult> {
  const user = await getAuthUser();
  if (!user) {
    return { error: "sign in to propose a merge" };
  }
  await ensureContributor(user.id, user.email ?? user.id);
  const result = await openMergeRequest({
    sourceId: input.sourceId,
    targetId: input.targetId,
    proposerId: user.id,
    note: input.note,
  });
  if ("id" in result) {
    await notifyBothRooms({
      mrId: result.id,
      sourceId: input.sourceId,
      targetId: input.targetId,
      action: "opened",
      actorName: user.email ?? undefined,
    });
  }
  return result;
}

export async function decideMergeRequestAction(input: {
  mrId: string;
  decision: "accepted" | "declined";
  decisionNote?: string | null;
}): Promise<DecideMergeResult> {
  const user = await getAuthUser();
  if (!user) {
    return { error: "sign in to review a merge" };
  }
  const result = await decideMergeRequest({
    mrId: input.mrId,
    reviewerId: user.id,
    decision: input.decision,
    decisionNote: input.decisionNote,
  });
  if ("ok" in result) {
    await notifyBothRooms({
      mrId: input.mrId,
      sourceId: result.sourceId,
      targetId: result.targetId,
      action: input.decision,
      actorName: user.email ?? undefined,
    });
  }
  return result;
}

export async function withdrawMergeRequestAction(input: {
  mrId: string;
}): Promise<DecideMergeResult> {
  const user = await getAuthUser();
  if (!user) {
    return { error: "sign in to withdraw a merge request" };
  }
  const result = await withdrawMergeRequest({
    mrId: input.mrId,
    userId: user.id,
  });
  if ("ok" in result) {
    await notifyBothRooms({
      mrId: input.mrId,
      sourceId: result.sourceId,
      targetId: result.targetId,
      action: "withdrawn",
      actorName: user.email ?? undefined,
    });
  }
  return result;
}
