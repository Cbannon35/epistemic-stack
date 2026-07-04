import "server-only";
import { createDb, schema } from "@epistack/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

// Threaded comments on chat messages. App-side discussion — separate from the
// commons claim graph (promoting a comment to a challenge/assessment is a
// future pathway). Private notes are filtered server-side to their author.

const db = createDb();

// Matches the agent's pseudo-contributor (agent/lib/commons.ts). Declared here
// rather than imported — that module pulls transformers/onnx into the bundle.
export const EVE_CONTRIBUTOR_ID = "00000000-0000-0000-0000-0000000000a1";

export async function ensureEveContributor(): Promise<void> {
  await db
    .insert(schema.contributors)
    .values({
      id: EVE_CONTRIBUTOR_ID,
      kind: "agent",
      displayName: "eve",
    })
    .onConflictDoNothing();
}

export type CommentRow = {
  id: string;
  sessionId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  messageId: string | null;
  quote: string | null;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  body: string;
  visibility: string;
  contextQueued: boolean;
  contextConsumedTurn: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

const visibleTo = (viewerId: string) =>
  or(
    eq(schema.comments.visibility, "public"),
    eq(schema.comments.authorId, viewerId)
  );

export async function listComments(
  sessionId: string,
  viewerId: string
): Promise<CommentRow[]> {
  const rows = await db
    .select({
      id: schema.comments.id,
      sessionId: schema.comments.sessionId,
      authorId: schema.comments.authorId,
      authorName: schema.contributors.displayName,
      parentId: schema.comments.parentId,
      messageId: schema.comments.messageId,
      quote: schema.comments.quote,
      quotePrefix: schema.comments.quotePrefix,
      quoteSuffix: schema.comments.quoteSuffix,
      body: schema.comments.body,
      visibility: schema.comments.visibility,
      contextQueued: schema.comments.contextQueued,
      contextConsumedTurn: schema.comments.contextConsumedTurn,
      resolvedAt: schema.comments.resolvedAt,
      createdAt: schema.comments.createdAt,
    })
    .from(schema.comments)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.comments.authorId)
    )
    .where(and(eq(schema.comments.sessionId, sessionId), visibleTo(viewerId)))
    .orderBy(asc(schema.comments.createdAt));
  return rows.map((r) => ({
    ...r,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function insertComment(input: {
  sessionId: string;
  authorId: string;
  body: string;
  visibility: "public" | "private";
  parentId?: string | null;
  anchor?: {
    messageId: string;
    quote: string;
    quotePrefix: string;
    quoteSuffix: string;
  } | null;
}): Promise<string> {
  const [row] = await db
    .insert(schema.comments)
    .values({
      sessionId: input.sessionId,
      authorId: input.authorId,
      body: input.body,
      visibility: input.visibility,
      parentId: input.parentId ?? null,
      messageId: input.anchor?.messageId ?? null,
      quote: input.anchor?.quote ?? null,
      quotePrefix: input.anchor?.quotePrefix ?? null,
      quoteSuffix: input.anchor?.quoteSuffix ?? null,
    })
    .returning({ id: schema.comments.id });
  return row.id;
}

export async function getComment(id: string) {
  const [row] = await db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.id, id))
    .limit(1);
  return row ?? null;
}

export async function setQueued(id: string, queued: boolean): Promise<void> {
  await db
    .update(schema.comments)
    .set({ contextQueued: queued })
    .where(eq(schema.comments.id, id));
}

export async function resolveComment(id: string): Promise<void> {
  await db
    .update(schema.comments)
    .set({ resolvedAt: new Date(), contextQueued: false })
    .where(eq(schema.comments.id, id));
}

export type QueuedThread = {
  rootId: string;
  quote: string | null;
  entries: Array<{ author: string; body: string }>;
};

// Threads queued to ride the viewer's next turn: unresolved roots with the
// queue flag, public or the viewer's own private notes; replies included.
export async function queuedContextFor(
  sessionId: string,
  viewerId: string
): Promise<QueuedThread[]> {
  const roots = await db
    .select({
      id: schema.comments.id,
      quote: schema.comments.quote,
      body: schema.comments.body,
      authorName: schema.contributors.displayName,
    })
    .from(schema.comments)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.comments.authorId)
    )
    .where(
      and(
        eq(schema.comments.sessionId, sessionId),
        eq(schema.comments.contextQueued, true),
        isNull(schema.comments.parentId),
        isNull(schema.comments.resolvedAt),
        visibleTo(viewerId)
      )
    )
    .orderBy(asc(schema.comments.createdAt));
  if (roots.length === 0) {
    return [];
  }
  const replies = await db
    .select({
      parentId: schema.comments.parentId,
      body: schema.comments.body,
      authorName: schema.contributors.displayName,
    })
    .from(schema.comments)
    .innerJoin(
      schema.contributors,
      eq(schema.contributors.id, schema.comments.authorId)
    )
    .where(
      inArray(
        schema.comments.parentId,
        roots.map((r) => r.id)
      )
    )
    .orderBy(asc(schema.comments.createdAt));
  return roots.map((root) => ({
    rootId: root.id,
    quote: root.quote,
    entries: [
      { author: root.authorName, body: root.body },
      ...replies
        .filter((reply) => reply.parentId === root.id)
        .map((reply) => ({ author: reply.authorName, body: reply.body })),
    ],
  }));
}

export async function markConsumed(
  ids: string[],
  turnId: string
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db
    .update(schema.comments)
    .set({ contextQueued: false, contextConsumedTurn: turnId })
    .where(inArray(schema.comments.id, ids));
}
