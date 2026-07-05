"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CommentAnchor } from "@/app/_components/comments/anchor";
import { useRoom } from "@/app/_components/room-provider";
import {
  addComment,
  listRoomComments,
  resolveComment,
  setCommentQueued,
} from "@/app/(chat)/comment-actions";
import type { CommentRow } from "@/lib/comments";

export type CommentThread = {
  root: CommentRow;
  replies: CommentRow[];
};

export type CommentsValue = {
  threads: CommentThread[];
  openThreadId: string | null;
  setOpenThreadId: (id: string | null) => void;
  add: (input: {
    body: string;
    visibility: "public" | "private";
    anchor: CommentAnchor;
  }) => Promise<void>;
  reply: (rootId: string, body: string) => Promise<void>;
  toggleQueued: (rootId: string, queued: boolean) => Promise<void>;
  resolve: (rootId: string) => Promise<void>;
};

const CommentsContext = createContext<CommentsValue | null>(null);

const EVE_MENTION = /^@eve\s*/i;

// Comments state for the open room: fetched on mount, refetched on the room
// channel's comments:changed broadcast, mutated through server actions.
export function useCommentsProvider(): CommentsValue {
  const room = useRoom();
  const { roomId, channel } = room;
  const { on, send } = channel;
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!roomId) {
      return;
    }
    setComments(await listRoomComments(roomId));
  }, [roomId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => on("comments:changed", () => refetch()), [on, refetch]);

  const me = room.me;
  // Detail (who did what) feeds the awareness ticker on other clients; plain
  // calls remain pure refetch signals.
  const broadcast = useCallback(
    (detail?: {
      action: "commented" | "replied" | "resolved";
      quote?: string;
    }) => {
      if (roomId) {
        send("comments:changed", {
          sessionId: roomId,
          ...(detail
            ? {
                actorId: me.userId,
                actorName: me.displayName,
                ...detail,
              }
            : {}),
        });
      }
    },
    [send, roomId, me.userId, me.displayName]
  );

  // Recent transcript tail — context for @eve thread replies.
  const buildContext = useCallback((): string => {
    const messages = room.data.messages ?? [];
    return messages
      .slice(-6)
      .map((m) => {
        const text = m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => (p.type === "text" ? p.text : ""))
          .join(" ")
          .slice(0, 300);
        return text ? `${m.role}: ${text}` : null;
      })
      .filter(Boolean)
      .join("\n");
  }, [room.data.messages]);

  const add = useCallback(
    async (input: {
      body: string;
      visibility: "public" | "private";
      anchor: CommentAnchor;
    }) => {
      if (!roomId) {
        return;
      }
      await addComment({ sessionId: roomId, ...input });
      await refetch();
      broadcast(
        // Private notes stay private — no narration, refetch only.
        input.visibility === "public"
          ? { action: "commented", quote: input.anchor.quote }
          : undefined
      );
    },
    [roomId, refetch, broadcast]
  );

  const reply = useCallback(
    async (rootId: string, body: string) => {
      if (!roomId) {
        return;
      }
      // Visibility is inherited from the thread root server-side.
      await addComment({
        sessionId: roomId,
        body,
        visibility: "public",
        parentId: rootId,
      });
      await refetch();
      const root = comments.find((c) => c.id === rootId);
      broadcast(
        root?.visibility === "public" ? { action: "replied" } : undefined
      );
      // "@eve …" also summons an in-thread reply from eve.
      const question = body.match(EVE_MENTION)
        ? body.replace(EVE_MENTION, "")
        : null;
      if (question) {
        await fetch("/api/comments/eve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commentId: rootId,
            question,
            context: buildContext(),
          }),
        }).catch(() => null);
        await refetch();
        broadcast();
      }
    },
    [roomId, refetch, broadcast, buildContext, comments]
  );

  const toggleQueued = useCallback(
    async (rootId: string, queued: boolean) => {
      // Optimistic: the checkmark feels instant.
      setComments((prev) =>
        prev.map((c) => (c.id === rootId ? { ...c, contextQueued: queued } : c))
      );
      await setCommentQueued({ commentId: rootId, queued });
      await refetch();
      broadcast();
    },
    [refetch, broadcast]
  );

  const resolve = useCallback(
    async (rootId: string) => {
      setOpenThreadId(null);
      const root = comments.find((c) => c.id === rootId);
      await resolveComment(rootId);
      await refetch();
      broadcast(
        root?.visibility === "public" ? { action: "resolved" } : undefined
      );
    },
    [refetch, broadcast, comments]
  );

  const threads = useMemo<CommentThread[]>(() => {
    const roots = comments.filter((c) => c.parentId === null);
    return roots.map((root) => ({
      root,
      replies: comments.filter((c) => c.parentId === root.id),
    }));
  }, [comments]);

  return {
    threads,
    openThreadId,
    setOpenThreadId,
    add,
    reply,
    toggleQueued,
    resolve,
  };
}

export const CommentsProvider = CommentsContext.Provider;

export function useComments(): CommentsValue {
  const ctx = useContext(CommentsContext);
  if (!ctx) {
    throw new Error("useComments must be used within CommentsProvider");
  }
  return ctx;
}
