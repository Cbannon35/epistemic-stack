"use client";

import { SearchIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useRoom } from "@/app/_components/room-provider";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { SidebarTrigger } from "@/components/ui/sidebar";

type Part = { type?: string; text?: string };
type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  parts?: Part[];
  text?: string;
  metadata?: { turnId?: string };
};

// Concatenate the text parts of a message. Non-text parts (reasoning, tool
// calls, step markers) are elided for now; they render as dedicated blocks once
// the commons tools land.
function textOf(m: Msg): string {
  const fromParts = (m.parts ?? [])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text as string)
    .join("\n\n");
  return fromParts || m.text || "";
}

export function AgentChat({ headerActions }: { headerActions?: ReactNode }) {
  const room = useRoom();
  const messages = (room.data as { messages?: Msg[] })?.messages ?? [];
  const isEmpty = messages.length === 0;
  const busy = room.status === "submitted" || room.status === "streaming";
  const foreignTurn =
    room.activeTurn && !room.activeTurn.mine
      ? (room.authors.get(room.activeTurn.turnId)?.displayName ??
        "another researcher")
      : null;

  const authorOf = (m: Msg): string | null => {
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
                    <MessageResponse>{textOf(m)}</MessageResponse>
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
