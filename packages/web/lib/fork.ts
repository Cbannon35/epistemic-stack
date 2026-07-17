import "server-only";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@epistack/db";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";

// GitHub-style fork: a durable branch of an investigation, cut at a specific
// turn. The commons is never copied — the fork inherits ancestor claims via
// time-bounded lineage scope (git-style refs, see lib/graph-data.ts). What IS
// copied is the app-side record: the transcript prelude (events), turn
// authorship, comment threads, and completed delegation records up to the
// branch point.
//
// Copied turn ids are remapped with a uniform prefix: eve turn ids are
// session-local (`turn_0`, `turn_1`, …) and the fork's FRESH eve session will
// re-emit the same ids — the client message reducer upserts by turn-derived
// message id, so unremapped copies would be silently overwritten by new turns.
// Fork-of-a-fork recurses naturally (`f_f_turn_3`).

const db = createDb();

const TURN_PREFIX = "f_";

type ForkEvent = {
  type: string;
  data?: { turnId?: string } & Record<string, unknown>;
  meta?: { at?: string } & Record<string, unknown>;
};

function remapTurn(turnId: string): string {
  return `${TURN_PREFIX}${turnId}`;
}

/** `turn_0:assistant` → `f_turn_0:assistant` (only when the turn was copied). */
function remapMessageId(
  messageId: string,
  preserved: ReadonlySet<string>
): string | null {
  const sep = messageId.lastIndexOf(":");
  if (sep === -1) {
    return null;
  }
  const turnId = messageId.slice(0, sep);
  if (!preserved.has(turnId)) {
    return null;
  }
  return `${remapTurn(turnId)}${messageId.slice(sep)}`;
}

type SlicedEvents = {
  events: ForkEvent[];
  /** Parent-side turn ids present in the slice (pre-remap). */
  preservedTurnIds: Set<string>;
  cutoffIso: string;
  /** True when the forked turn is the parent's latest — a branch off the
   * room as it stands, not a rewind. */
  atTip: boolean;
};

// Cut the durable stream after the forked turn's last event. Session-level
// events before the cut ride along verbatim; the slice is closed with a
// `session.waiting` (copied if the parent has one there, synthesized
// otherwise) so the reduced transcript ends idle — never with
// session.completed/failed, which would make the fork unsendable.
function sliceEvents(events: ForkEvent[], turnId: string): SlicedEvents | null {
  let cut = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].data?.turnId === turnId) {
      cut = i;
      break;
    }
  }
  if (cut === -1) {
    return null;
  }
  const slice = events.slice(0, cut + 1);
  const cutoffIso =
    [...slice].reverse().find((e) => e.meta?.at)?.meta?.at ??
    new Date().toISOString();
  const next = events[cut + 1];
  if (next?.type === "session.waiting") {
    slice.push(next);
  } else {
    slice.push({
      type: "session.waiting",
      data: { wait: "next-user-message" },
      meta: { at: cutoffIso },
    });
  }
  const preservedTurnIds = new Set<string>();
  for (const e of slice) {
    if (e.data?.turnId) {
      preservedTurnIds.add(e.data.turnId);
    }
  }
  // Tip check: no turn-scoped event after the cut belongs to a LATER turn.
  const atTip = !events
    .slice(cut + 1)
    .some((e) => e.data?.turnId && e.data.turnId !== turnId);
  return { events: slice, preservedTurnIds, cutoffIso, atTip };
}

function remapEvents(events: ForkEvent[]): ForkEvent[] {
  return events.map((e) =>
    e.data?.turnId
      ? { ...e, data: { ...e.data, turnId: remapTurn(e.data.turnId) } }
      : e
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function copyTurnAuthors(
  tx: Tx,
  parentId: string,
  forkId: string,
  preserved: ReadonlySet<string>
): Promise<void> {
  if (preserved.size === 0) {
    return;
  }
  const rows = await tx
    .select()
    .from(schema.investigationTurns)
    .where(
      and(
        eq(schema.investigationTurns.sessionId, parentId),
        inArray(schema.investigationTurns.turnId, [...preserved])
      )
    );
  if (rows.length === 0) {
    return;
  }
  await tx.insert(schema.investigationTurns).values(
    rows.map((r) => ({
      sessionId: forkId,
      turnId: remapTurn(r.turnId),
      contributorId: r.contributorId,
      createdAt: r.createdAt,
    }))
  );
}

// Copy comment threads on preserved messages (room-level comments ride along
// when they predate the cut). Uuids are regenerated; the reply tree is remapped
// through an old→new id map, roots first — replies whose root wasn't preserved
// are skipped. Quote anchors copy verbatim: they resolve against the copied
// transcript, whose remapped message ids we mirror here.
async function copyComments(
  tx: Tx,
  parentId: string,
  forkId: string,
  preserved: ReadonlySet<string>,
  cutoff: Date
): Promise<void> {
  const rows = await tx
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.sessionId, parentId));
  const kept = rows.filter((r) =>
    r.messageId
      ? remapMessageId(r.messageId, preserved) !== null
      : r.createdAt <= cutoff
  );
  if (kept.length === 0) {
    return;
  }
  const newIdOf = new Map(kept.map((r) => [r.id, randomUUID()]));
  const copyOf = (r: (typeof kept)[number]) => ({
    id: newIdOf.get(r.id) as string,
    sessionId: forkId,
    authorId: r.authorId,
    parentId: r.parentId ? (newIdOf.get(r.parentId) ?? null) : null,
    messageId: r.messageId ? remapMessageId(r.messageId, preserved) : null,
    quote: r.quote,
    quotePrefix: r.quotePrefix,
    quoteSuffix: r.quoteSuffix,
    body: r.body,
    visibility: r.visibility,
    // One-shot context state resets: nothing has ridden a fork turn yet, and a
    // consumption that happened past the cut never happened on this branch.
    contextQueued: false,
    contextConsumedTurn:
      r.contextConsumedTurn && preserved.has(r.contextConsumedTurn)
        ? remapTurn(r.contextConsumedTurn)
        : null,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
  });
  const roots = kept.filter((r) => !r.parentId);
  const replies = kept.filter(
    (r) => r.parentId && newIdOf.has(r.parentId) // orphaned replies are skipped
  );
  await tx.insert(schema.comments).values(roots.map(copyOf));
  if (replies.length > 0) {
    await tx.insert(schema.comments).values(replies.map(copyOf));
  }
}

// Delegations carry no turn id — COMPLETED before the cut (updatedAt is the
// completion moment) is the consistency rule: everything a copied delegation
// surfaced then also predates the cutoff, so its findings are in the fork's
// graph scope. Output node ids are commons-global and stay valid.
async function copyDelegations(
  tx: Tx,
  parentId: string,
  forkId: string,
  cutoff: Date
): Promise<void> {
  const rows = await tx
    .select()
    .from(schema.delegations)
    .where(
      and(
        eq(schema.delegations.sessionId, parentId),
        eq(schema.delegations.status, "completed"),
        lte(schema.delegations.updatedAt, cutoff)
      )
    );
  if (rows.length === 0) {
    return;
  }
  await tx.insert(schema.delegations).values(
    rows.map((r) => ({
      ...r,
      id: randomUUID(),
      sessionId: forkId,
    }))
  );
}

export type DeleteForkResult = { ok: true } | { error: string };

// Deleting a fork removes the app-side branch record only — transcript copy,
// comments, turn authorship, delegation records. Everything it recorded in
// the COMMONS stays (append-only; those receipts belong to the ledger, not
// the room). Root investigations are permanent, and a fork with forks of its
// own can't be deleted (children inherit scope through it).
export async function deleteFork(input: {
  id: string;
  userId: string;
}): Promise<DeleteForkResult> {
  const [row] = await db
    .select({
      forkedFrom: schema.investigations.forkedFrom,
      contributorId: schema.investigations.contributorId,
    })
    .from(schema.investigations)
    .where(eq(schema.investigations.id, input.id))
    .limit(1);
  if (!row) {
    return { error: "that fork no longer exists" };
  }
  if (!row.forkedFrom) {
    return { error: "only forks can be deleted — root investigations stay" };
  }
  if (row.contributorId !== input.userId) {
    return { error: "only the fork's owner can delete it" };
  }
  const [child] = await db
    .select({ id: schema.investigations.id })
    .from(schema.investigations)
    .where(eq(schema.investigations.forkedFrom, input.id))
    .limit(1);
  if (child) {
    return { error: "this fork has forks of its own — delete those first" };
  }
  await db.transaction(async (tx) => {
    // Merge-request tidy-up: open proposals FROM this fork are withdrawn (the
    // branch is gone); requests TARGETING it lose their room and are removed.
    // ACCEPTED outgoing merges are untouched — their materialized hops keep
    // resolving against the commons, which survives fork deletion.
    await tx
      .update(schema.mergeRequests)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(
        and(
          eq(schema.mergeRequests.sourceId, input.id),
          eq(schema.mergeRequests.status, "open")
        )
      );
    await tx
      .delete(schema.mergeRequests)
      .where(eq(schema.mergeRequests.targetId, input.id));
    await tx
      .delete(schema.delegations)
      .where(eq(schema.delegations.sessionId, input.id));
    // Replies first (self-FK on parent_id), then roots.
    await tx
      .delete(schema.comments)
      .where(
        and(
          eq(schema.comments.sessionId, input.id),
          isNotNull(schema.comments.parentId)
        )
      );
    await tx
      .delete(schema.comments)
      .where(eq(schema.comments.sessionId, input.id));
    await tx
      .delete(schema.investigationTurns)
      .where(eq(schema.investigationTurns.sessionId, input.id));
    await tx
      .delete(schema.investigations)
      .where(eq(schema.investigations.id, input.id));
  });
  return { ok: true };
}

export type ForkResult = { id: string } | { error: string };

export async function forkInvestigation(input: {
  parentId: string;
  turnId: string;
  userId: string;
}): Promise<ForkResult> {
  const [parent] = await db
    .select()
    .from(schema.investigations)
    .where(eq(schema.investigations.id, input.parentId))
    .limit(1);
  if (!parent) {
    return { error: "that investigation no longer exists" };
  }
  const events = Array.isArray(parent.events)
    ? (parent.events as ForkEvent[])
    : [];
  const sliced = sliceEvents(events, input.turnId);
  if (!sliced) {
    return {
      error:
        "that turn hasn't finished being saved yet — try again in a moment",
    };
  }
  const forkId = `fork_${randomUUID()}`;
  // Tip forks branch off "the room as it stands NOW": rooms keep accruing
  // commons writes after the last chat message (delegated runs, tours, cursor
  // chat), and all of that belongs to the branch point. Only mid-history
  // forks rewind to the forked message's own moment.
  const cutoff = sliced.atTip ? new Date() : new Date(sliced.cutoffIso);
  const prelude = remapEvents(sliced.events);

  await db.transaction(async (tx) => {
    await tx.insert(schema.investigations).values({
      id: forkId,
      contributorId: input.userId,
      title: parent.title,
      sessionState: null,
      events: prelude,
      forkedFrom: parent.id,
      forkedAtTurn: input.turnId,
      forkCutoff: cutoff,
      forkPreludeCount: prelude.length,
      seedFromCommons: parent.seedFromCommons,
    });
    await copyTurnAuthors(tx, parent.id, forkId, sliced.preservedTurnIds);
    await copyComments(tx, parent.id, forkId, sliced.preservedTurnIds, cutoff);
    await copyDelegations(tx, parent.id, forkId, cutoff);
  });

  return { id: forkId };
}
