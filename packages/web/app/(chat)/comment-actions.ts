"use server";

import type { CommentRow } from "@/lib/comments";
import {
  getComment,
  insertComment,
  listComments,
  markConsumed,
  queuedContextFor,
  resolveComment as resolveInDb,
  setQueued,
} from "@/lib/comments";
import { ensureContributor } from "@/lib/contributors";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function listRoomComments(
  sessionId: string
): Promise<CommentRow[]> {
  const user = await requireUser();
  if (!user) {
    return [];
  }
  return listComments(sessionId, user.id);
}

export type CommentAnchor = {
  messageId: string;
  quote: string;
  quotePrefix: string;
  quoteSuffix: string;
};

export async function addComment(input: {
  sessionId: string;
  body: string;
  visibility: "public" | "private";
  anchor?: CommentAnchor | null;
  parentId?: string | null;
}): Promise<string | null> {
  const user = await requireUser();
  if (!user || !input.body.trim()) {
    return null;
  }
  // Replies inherit the thread's visibility (a private note stays private),
  // and you can only reply to threads you can see.
  let visibility = input.visibility;
  if (input.parentId) {
    const root = await getComment(input.parentId);
    if (!root) {
      return null;
    }
    if (root.visibility === "private" && root.authorId !== user.id) {
      return null;
    }
    visibility = root.visibility as "public" | "private";
  }
  await ensureContributor(user.id, user.email ?? user.id);
  return insertComment({
    sessionId: input.sessionId,
    authorId: user.id,
    body: input.body.trim().slice(0, 2000),
    visibility,
    parentId: input.parentId ?? null,
    anchor: input.anchor ?? null,
  });
}

// Anyone in the room can queue a public thread; private notes only their author.
export async function setCommentQueued(input: {
  commentId: string;
  queued: boolean;
}): Promise<void> {
  const user = await requireUser();
  if (!user) {
    return;
  }
  const comment = await getComment(input.commentId);
  if (!comment) {
    return;
  }
  if (comment.visibility === "private" && comment.authorId !== user.id) {
    return;
  }
  await setQueued(input.commentId, input.queued);
}

export async function resolveComment(commentId: string): Promise<void> {
  const user = await requireUser();
  if (!user) {
    return;
  }
  const comment = await getComment(commentId);
  if (!comment) {
    return;
  }
  if (comment.visibility === "private" && comment.authorId !== user.id) {
    return;
  }
  await resolveInDb(commentId);
}

const DIGEST_LIMIT = 2000;

// The one-shot payload: queued threads formatted for clientContext, plus the
// ids to flip to "consumed" once the turn is accepted.
export async function getQueuedCommentContext(
  sessionId: string
): Promise<{ ids: string[]; digest: string } | null> {
  const user = await requireUser();
  if (!user) {
    return null;
  }
  const threads = await queuedContextFor(sessionId, user.id);
  if (threads.length === 0) {
    return null;
  }
  const ids: string[] = [];
  const blocks: string[] = [];
  let length = 0;
  for (const thread of threads) {
    const block = [
      thread.quote ? `On the passage "${thread.quote.slice(0, 200)}":` : null,
      ...thread.entries.map((entry) => `- ${entry.author}: ${entry.body}`),
    ]
      .filter(Boolean)
      .join("\n");
    if (length + block.length > DIGEST_LIMIT) {
      break;
    }
    ids.push(thread.rootId);
    blocks.push(block);
    length += block.length;
  }
  if (ids.length === 0) {
    return null;
  }
  return {
    ids,
    digest: `The team pinned these comment threads from reviewing your earlier answers — take them into account:\n\n${blocks.join("\n\n")}`,
  };
}

export async function markCommentsConsumed(input: {
  ids: string[];
  turnId: string;
}): Promise<void> {
  const user = await requireUser();
  if (!user) {
    return;
  }
  await markConsumed(input.ids, input.turnId);
}
