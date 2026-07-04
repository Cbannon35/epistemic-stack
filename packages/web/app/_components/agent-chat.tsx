"use client";

import type { EveMessage } from "eve/client";
import { SearchIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { MessagePart } from "@/app/_components/chat/message-parts";
import { useRoom } from "@/app/_components/room-provider";
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
        <span className="ml-auto flex items-center gap-2">{headerActions}</span>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {isEmpty ? (
            <ConversationEmptyState
              description="Ask a contested, settled, or everyday question — I'll build a sourced claim graph."
              icon={<SearchIcon className="size-5" />}
              title="Start an investigation"
            />
          ) : (
            messages.map((m) => {
              const author = authorOf(m);
              return (
                <Message className="message-fade-in" from={m.role} key={m.id}>
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
      </Conversation>

      {room.error ? (
        <p className="mx-auto w-full max-w-3xl px-4 pb-2 text-destructive text-sm">
          {room.error.message}
        </p>
      ) : null}

      <div className="mx-auto w-full max-w-3xl p-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            disabled={room.completed}
            placeholder={
              room.completed
                ? "This investigation has concluded."
                : foreignTurn
                  ? `${foreignTurn} is asking…`
                  : "Ask a research question…"
            }
          />
          <PromptInputSubmit
            disabled={busy || room.completed}
            status={room.status}
          />
        </PromptInput>
      </div>
    </main>
  );
}
