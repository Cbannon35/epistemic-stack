"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PromoteChallengeHost } from "@/app/_components/challenges/promote-to-challenge";
import { findQuoteRange } from "@/app/_components/comments/anchor";
import { ThreadCard } from "@/app/_components/comments/thread-popover";
import {
  type CommentThread,
  useComments,
} from "@/app/_components/comments/use-comments";
import { useRoom } from "@/app/_components/room-provider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { colorForUser, hueForUser } from "@/lib/realtime/color";

type PlacedThread = {
  thread: CommentThread;
  messageEl: Element;
  left: number;
  top: number;
  anchored: boolean;
};

const HIGHLIGHT_PREFIX = "comment-h";
const PRIVATE_HIGHLIGHT = "comment-private";

// Paints persistent highlights for anchored comment threads (CSS Custom
// Highlight API — no DOM mutation, so no fights with React/streamdown) and
// portals a count badge into each message at the quote's end. Clicking a
// badge opens the thread popover.
export function HighlightLayer() {
  const { threads, openThreadId, setOpenThreadId } = useComments();
  const room = useRoom();
  const [placed, setPlaced] = useState<PlacedThread[]>([]);
  const messageCount = room.data.messages?.length ?? 0;
  const lastMessage = room.data.messages?.at(-1);
  const streaming =
    lastMessage?.metadata?.status === "streaming" ? "yes" : "no";

  const repaint = useCallback(() => {
    const anchored = threads.filter(
      (t) => t.root.messageId && t.root.quote && !t.root.resolvedAt
    );
    const byName = new Map<string, Range[]>();
    const next: PlacedThread[] = [];

    for (const thread of anchored) {
      const { root } = thread;
      const messageEl = document.querySelector(
        `[data-message-id="${CSS.escape(root.messageId as string)}"]`
      );
      if (!messageEl) {
        continue;
      }
      const range = findQuoteRange(
        messageEl,
        root.quote as string,
        root.quotePrefix,
        root.quoteSuffix
      );
      if (range) {
        const name =
          root.visibility === "private"
            ? PRIVATE_HIGHLIGHT
            : `${HIGHLIGHT_PREFIX}${hueForUser(root.authorId)}`;
        const list = byName.get(name) ?? [];
        list.push(range);
        byName.set(name, list);
        const rects = range.getClientRects();
        const last = rects.item(rects.length - 1);
        const messageRect = messageEl.getBoundingClientRect();
        next.push({
          thread,
          messageEl,
          left: last
            ? last.right - messageRect.left + 2
            : messageRect.width - 8,
          top: last ? last.top - messageRect.top - 8 : 0,
          anchored: Boolean(last),
        });
      } else {
        // Quote not re-found (e.g. message still streaming): badge falls back
        // to the message's top-right so the thread stays reachable.
        next.push({
          thread,
          messageEl,
          left: messageEl.getBoundingClientRect().width - 12,
          top: -6,
          anchored: false,
        });
      }
    }

    // Custom Highlight API: repaint all names we own.
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> })
      .highlights;
    if (highlights) {
      for (const key of [...highlights.keys()]) {
        if (key.startsWith(HIGHLIGHT_PREFIX) || key === PRIVATE_HIGHLIGHT) {
          highlights.delete(key);
        }
      }
      const HighlightCtor = (
        globalThis as unknown as {
          Highlight?: new (...ranges: Range[]) => unknown;
        }
      ).Highlight;
      if (HighlightCtor) {
        for (const [name, ranges] of byName) {
          highlights.set(name, new HighlightCtor(...ranges));
        }
      }
    }
    setPlaced(next);
  }, [threads]);

  // Repaint when threads or the transcript change (new messages, streaming
  // completion re-renders), and on resize. rAF defers past React's commit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messageCount/streaming are repaint triggers, read inside the DOM pass
  useEffect(() => {
    const raf = requestAnimationFrame(repaint);
    return () => cancelAnimationFrame(raf);
  }, [repaint, messageCount, streaming]);

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(repaint);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [repaint]);

  return (
    <>
      {/* Owns the promote-to-challenge dialog OUTSIDE the thread popovers —
          the popover dismisses when a portaled dialog takes focus. */}
      <PromoteChallengeHost />
      {placed.map(({ thread, messageEl, left, top }) =>
        createPortal(
          <Popover
            key={thread.root.id}
            onOpenChange={(open) =>
              setOpenThreadId(open ? thread.root.id : null)
            }
            open={openThreadId === thread.root.id}
          >
            <PopoverTrigger asChild>
              <button
                className="cursor-pointer rounded-full border bg-background px-1 py-0 font-medium text-[9px] leading-4 shadow-sm transition-transform duration-150 hover:scale-110 active:scale-95"
                data-comments-ui
                style={{
                  position: "absolute",
                  left,
                  top,
                  borderColor: colorForUser(thread.root.authorId),
                  color: colorForUser(thread.root.authorId),
                  zIndex: 10,
                }}
                type="button"
              >
                {1 + thread.replies.length}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              collisionPadding={12}
              data-comments-ui
              side="bottom"
            >
              <ThreadCard thread={thread} />
            </PopoverContent>
          </Popover>,
          messageEl
        )
      )}
    </>
  );
}
