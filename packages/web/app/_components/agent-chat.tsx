"use client";

import type { EveMessage } from "eve/client";
import { GitForkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useRef } from "react";
import { CatchUpDigest } from "@/app/_components/awareness/digest-card";
import {
  TypingLine,
  useTypingPresence,
} from "@/app/_components/awareness/typing";
import { MessagePart } from "@/app/_components/chat/message-parts";
import { HighlightLayer } from "@/app/_components/comments/highlight-layer";
import { SelectionToolbar } from "@/app/_components/comments/selection-toolbar";
import {
  CommentsProvider,
  useCommentsProvider,
} from "@/app/_components/comments/use-comments";
import { RelatedPriorWork } from "@/app/_components/commons/related-work";
import { EmptyRoomState } from "@/app/_components/onboarding/room-hints";
import { PresenceAvatars } from "@/app/_components/presence/presence-avatars";
import { useRoom } from "@/app/_components/room-provider";
import { NodeMentionPicker } from "@/app/_components/weave/node-mention";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function AgentChat({ headerActions }: { headerActions?: ReactNode }) {
  const room = useRoom();
  const router = useRouter();
  const comments = useCommentsProvider();
  const composerRef = useRef<HTMLDivElement | null>(null);
  const { noteTyping, typers } = useTypingPresence();
  const messages: readonly EveMessage[] = room.data.messages ?? [];
  const isEmpty = messages.length === 0;
  const busy = room.status === "submitted" || room.status === "streaming";
  const foreignTurn =
    room.activeTurn && !room.activeTurn.mine
      ? (room.authors.get(room.activeTurn.turnId)?.displayName ??
        "another researcher")
      : null;

  const authorOf = (m: EveMessage): string | null => {
    if (m.role !== "user") {
      return null;
    }
    const turnId = m.metadata?.turnId;
    const name = turnId ? room.authors.get(turnId)?.displayName : null;
    // Optimistic messages have no turn id yet — they're always mine.
    return name ?? (turnId ? null : room.me.displayName);
  };

  const handleSubmit = (message: { text?: string }, event: FormEvent) => {
    event.preventDefault();
    const text = message.text?.trim();
    if (!text || busy || room.completed) {
      return;
    }
    room.send({ message: text });
  };

  return (
    <CommentsProvider value={comments}>
      <main className="flex h-full w-full flex-col">
        <header className="flex items-center gap-2 border-border/40 border-b px-3 py-2.5">
          <SidebarTrigger />
          <span className="font-medium text-sm">Research agent</span>
          {busy ? (
            <span
              className="fade-in flex items-center gap-1.5 text-muted-foreground text-xs"
              title={room.status}
            >
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              {foreignTurn ? `${foreignTurn} is asking…` : "researching…"}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <PresenceAvatars view="chat" />
            {room.session.sessionId ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-[background-color,border-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] active:bg-muted"
                onClick={() =>
                  router.push(
                    `/?fork=${encodeURIComponent(room.session.sessionId as string)}`
                  )
                }
                title="Branch a new investigation that starts from this one's claim graph"
                type="button"
              >
                <GitForkIcon className="size-3.5" />
                Fork
              </button>
            ) : null}
            {headerActions}
          </span>
        </header>

        {/* Pinned above the transcript — the conversation sticks to the
            bottom, so anything inside the scroller would go unseen. */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-2 empty:hidden">
          <CatchUpDigest />
        </div>

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl">
            {isEmpty ? (
              <ConversationEmptyState>
                <EmptyRoomState forked={Boolean(room.forkFrom)} />
              </ConversationEmptyState>
            ) : (
              messages.map((m) => {
                const author = authorOf(m);
                return (
                  <Message
                    className="message-fade-in relative"
                    data-message-id={m.id}
                    data-role={m.role}
                    from={m.role}
                    key={m.id}
                  >
                    <MessageContent>
                      {author ? (
                        <span className="mb-0.5 block text-[10px] text-muted-foreground">
                          {author}
                        </span>
                      ) : null}
                      {m.parts.map((part, index) => (
                        <MessagePart
                          // Parts are append-only within a message; index keys are stable.
                          // biome-ignore lint/suspicious/noArrayIndexKey: see above
                          key={`${m.id}:${index}`}
                          part={part}
                        />
                      ))}
                    </MessageContent>
                  </Message>
                );
              })
            )}
          </ConversationContent>
          <ConversationScrollButton />
          <SelectionToolbar />
          <HighlightLayer />
        </Conversation>

        <RelatedPriorWork />

        {room.error ? (
          <p className="mx-auto w-full max-w-3xl px-4 pb-2 text-destructive text-sm">
            {room.error.message}
          </p>
        ) : null}

        <div
          className="relative mx-auto w-full max-w-3xl p-4 pt-0"
          ref={composerRef}
        >
          <NodeMentionPicker containerRef={composerRef} roomId={room.roomId} />
          {/* Typing hands off to the header's "‹name› is asking…" once a turn starts. */}
          <TypingLine hidden={busy} typers={typers} />
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              disabled={room.completed}
              onChange={noteTyping}
              placeholder={
                room.completed
                  ? "This investigation has concluded."
                  : foreignTurn
                    ? `${foreignTurn} is asking…`
                    : "Ask a research question… (# references a graph node)"
              }
            />
            <PromptInputSubmit
              disabled={busy || room.completed}
              status={room.status}
            />
          </PromptInput>
        </div>
      </main>
    </CommentsProvider>
  );
}
