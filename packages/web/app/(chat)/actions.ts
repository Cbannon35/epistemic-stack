"use server";

import { ensureContributor } from "@/lib/contributors";
import {
  getInvestigation,
  insertTurnAuthor,
  saveInvestigationSession,
  type TurnAuthor,
  upsertInvestigation,
} from "@/lib/investigations";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Called from the sender's client: create the room row on first send (keyed by
// the eve session id, titled by the question) and save the session snapshot at
// each turn boundary. Attributed to the signed-in user.
export async function saveInvestigation(input: {
  sessionId: string;
  title: string;
  sessionState: unknown;
  events: unknown;
  forkedFrom?: string | null;
}): Promise<void> {
  const user = await requireUser();
  if (!user) {
    return;
  }
  await ensureContributor(user.id, user.email ?? user.id);
  await upsertInvestigation({
    id: input.sessionId,
    contributorId: user.id,
    title: input.title.slice(0, 200),
    forkedFrom: input.forkedFrom ?? null,
  });
  await saveInvestigationSession({
    id: input.sessionId,
    sessionState: input.sessionState,
    events: input.events,
    updatedAt: new Date(),
  });
}

// The room boot snapshot is served by GET /api/room/[id] (a route handler,
// not a server action, because AppShell loads it during render).
export type InvestigationRoom = {
  session: unknown;
  events: unknown;
  title: string;
  forkedFrom: string | null;
  authors: TurnAuthor[];
};

// Fetched at send time so a member always sends with the current continuation
// token, even if they joined before other members' turns.
export async function getSendState(id: string): Promise<unknown> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  const inv = await getInvestigation(id);
  return inv?.sessionState ?? null;
}

// Record who sent a turn. Identity comes from Supabase auth server-side — the
// client never asserts it.
export async function recordTurnAuthor(input: {
  sessionId: string;
  turnId: string;
}): Promise<void> {
  const user = await requireUser();
  if (!user) {
    return;
  }
  await ensureContributor(user.id, user.email ?? user.id);
  await insertTurnAuthor({
    sessionId: input.sessionId,
    turnId: input.turnId,
    contributorId: user.id,
  });
}

// The last visible assistant answer in a persisted event stream: scan backwards
// for message.completed with real text (tool-call boundaries have none).
function lastAssistantAnswer(events: unknown): string | null {
  if (!Array.isArray(events)) {
    return null;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as {
      type?: string;
      data?: { message?: string | null; finishReason?: string };
    };
    if (
      e?.type === "message.completed" &&
      e.data?.message &&
      e.data.finishReason !== "tool-calls"
    ) {
      return e.data.message;
    }
  }
  return null;
}

// Context injected (via clientContext) into the first turn of a fork so the
// agent knows what it's branching from. The fork also adopts the parent's
// graph scope, so prior claims are queryable through the commons tools.
export async function getForkSeed(
  parentId: string
): Promise<{ title: string; seed: string } | null> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  const parent = await getInvestigation(parentId);
  if (!parent) {
    return null;
  }
  const answer = lastAssistantAnswer(parent.events);
  const seed = [
    `This investigation was forked from "${parent.title}".`,
    answer
      ? `Where that investigation left off:\n${answer.slice(0, 2000)}`
      : null,
    "The parent's claims, sources, hypotheses and cruxes are already in scope — query the commons before re-researching; build on them.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { title: parent.title, seed };
}
