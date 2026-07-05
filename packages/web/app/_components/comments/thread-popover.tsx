"use client";

import {
  CheckCircle2Icon,
  CheckIcon,
  HistoryIcon,
  LockIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { PromoteToChallenge } from "@/app/_components/challenges/promote-to-challenge";
import {
  type CommentThread,
  useComments,
} from "@/app/_components/comments/use-comments";
import type { CommentRow } from "@/lib/comments";
import { colorForUser, EVE_COLOR, initialsFor } from "@/lib/realtime/color";

export const EVE_AUTHOR_ID = "00000000-0000-0000-0000-0000000000a1";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) {
    return "now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  return `${Math.floor(seconds / 86_400)}d`;
}

function Entry({ comment }: { comment: CommentRow }) {
  const isEve = comment.authorId === EVE_AUTHOR_ID;
  const color = isEve ? EVE_COLOR : colorForUser(comment.authorId);
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full font-medium text-[8px] text-white"
        style={{ backgroundColor: color }}
      >
        {isEve ? (
          <SparklesIcon className="size-2.5" />
        ) : (
          initialsFor(comment.authorName)
        )}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground">
          {isEve ? "eve" : comment.authorName.split("@")[0]} ·{" "}
          {timeAgo(comment.createdAt)}
        </p>
        <p className="whitespace-pre-wrap text-xs leading-snug">
          {comment.body}
        </p>
      </div>
    </div>
  );
}

// One comment thread: quote header, entries, reply box (@eve summons eve),
// and the one-shot context checkmark — unchecked → queued (rides the NEXT
// question) → consumed (muted "was in the model's context", re-checkable).
export function ThreadCard({ thread }: { thread: CommentThread }) {
  const { reply, toggleQueued, resolve, setOpenThreadId } = useComments();
  const { root, replies } = thread;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const color = colorForUser(root.authorId);
  const isPrivate = root.visibility === "private";
  const consumed = !root.contextQueued && root.contextConsumedTurn !== null;

  const submitReply = async () => {
    const body = draft.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    setDraft("");
    await reply(root.id, body);
    setSending(false);
  };

  return (
    <div className="flex max-h-96 flex-col">
      <div
        className="flex items-center gap-1.5 border-b px-3 py-2"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        {isPrivate ? (
          <LockIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : null}
        <p className="line-clamp-2 text-[11px] text-muted-foreground italic">
          “{root.quote}”
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
        <Entry comment={root} />
        {replies.map((r) => (
          <Entry comment={r} key={r.id} />
        ))}
        {sending ? (
          <p className="text-[10px] text-muted-foreground">
            <span className="shimmer">…</span>
          </p>
        ) : null}
      </div>

      <div className="border-t px-3 py-2">
        <input
          className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitReply();
            }
          }}
          placeholder="Reply… (@eve to ask eve)"
          type="text"
          value={draft}
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            className={`flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[10px] transition-[background-color,color] duration-150 ${
              root.contextQueued
                ? "bg-emerald-600/10 font-medium text-emerald-600"
                : consumed
                  ? "text-muted-foreground/60 hover:text-muted-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            onClick={() => toggleQueued(root.id, !root.contextQueued)}
            title={
              root.contextQueued
                ? "Queued — rides the next question. Click to remove."
                : consumed
                  ? "Was in the model's context on an earlier turn — click to queue it again."
                  : "Include this thread in the next question's context."
            }
            type="button"
          >
            {root.contextQueued ? (
              <>
                <CheckCircle2Icon className="size-3.5" /> rides next question
              </>
            ) : consumed ? (
              <>
                <HistoryIcon className="size-3" /> was in context · re-queue
              </>
            ) : (
              <>
                <CheckIcon className="size-3.5" /> include in next question
              </>
            )}
          </button>
          <span className="flex items-center">
            {isPrivate ? null : (
              <PromoteToChallenge
                commentId={root.id}
                onDone={() => setOpenThreadId(null)}
              />
            )}
            <button
              className="cursor-pointer rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-[background-color,color] duration-150 hover:bg-muted hover:text-foreground"
              onClick={() => resolve(root.id)}
              title="Resolve — hides the highlight, keeps the thread"
              type="button"
            >
              resolve
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
