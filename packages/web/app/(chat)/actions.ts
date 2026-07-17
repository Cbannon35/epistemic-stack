"use server";

import { ensureContributor } from "@/lib/contributors";
import {
  claimEveSession,
  getInvestigation,
  insertTurnAuthor,
  renameInvestigation,
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
// the eve session id — fork rows pre-exist under an app id) and save the
// session snapshot at each turn boundary. Attributed to the signed-in user.
// When `eveSessionId` is passed (first send), the write is a conditional CLAIM:
// two members racing a fork's first send can't split the room across two eve
// sessions — the loser's write drops and their next send resumes the winner's.
export async function saveInvestigation(input: {
  sessionId: string;
  title: string;
  sessionState: unknown;
  events: unknown;
  forkedFrom?: string | null;
  eveSessionId?: string | null;
  seedFromCommons?: boolean;
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
    eveSessionId: input.eveSessionId ?? null,
    seedFromCommons: input.seedFromCommons,
  });
  if (input.eveSessionId) {
    await claimEveSession({
      id: input.sessionId,
      eveSessionId: input.eveSessionId,
      sessionState: input.sessionState,
      events: input.events,
    });
    return;
  }
  await saveInvestigationSession({
    id: input.sessionId,
    sessionState: input.sessionState,
    events: input.events,
    updatedAt: new Date(),
  });
}

// Owner-only retitle from the sidebar. The caller refreshes the router to
// land the new title in everyone's list.
export async function renameInvestigationAction(input: {
  id: string;
  title: string;
}): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const title = input.title.trim().slice(0, 200);
  if (!(user && title)) {
    return { ok: false };
  }
  return {
    ok: await renameInvestigation({ id: input.id, title, ownerId: user.id }),
  };
}

// The room boot snapshot is served by GET /api/room/[id] (a route handler,
// not a server action, because AppShell loads it during render).
export type InvestigationRoom = {
  session: unknown;
  events: unknown;
  title: string;
  /** The investigation's owner (contributor id) — merge reviews are theirs. */
  ownerId: string | null;
  forkedFrom: string | null;
  /** Copied transcript events on a fork row — the live-stream cursor offset. */
  forkPreludeCount: number | null;
  /** Read-time seeding choice recorded on the row. */
  seedFromCommons: boolean;
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
// graph scope up to the fork moment, so prior claims are queryable through the
// commons tools. Called with either the PARENT id (legacy `/?fork=` rooms) or
// the FORK's own row id — a fork row's truncated events make
// lastAssistantAnswer return exactly the forked message.
export async function getForkSeed(
  id: string
): Promise<{ title: string; seed: string } | null> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  const row = await getInvestigation(id);
  if (!row) {
    return null;
  }
  const answer = lastAssistantAnswer(row.events);
  const seed = [
    `This investigation was forked from "${row.title}".`,
    answer ? `The response it was forked at:\n${answer.slice(0, 2000)}` : null,
    "The transcript above the fork point is preserved for readers, but it is NOT in your working memory — the branch-point claims, sources, hypotheses and cruxes are in your graph scope; query the commons before re-researching, and build on them.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { title: row.title, seed };
}
