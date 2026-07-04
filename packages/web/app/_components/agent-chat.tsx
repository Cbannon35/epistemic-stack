"use client";

import { SearchIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEveChat } from "@/app/_components/eve-session";
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
  const agent = useEveChat();
  const messages = (agent.data as { messages?: Msg[] })?.messages ?? [];
  const isEmpty = messages.length === 0;
  const busy = agent.status === "submitted" || agent.status === "streaming";

  const handleSubmit = (message: { text?: string }, event: FormEvent) => {
    event.preventDefault();
    const text = message.text?.trim();
    if (!text || busy) {
      return;
    }
    agent.send({ message: text });
  };

  return (
    <main className="flex h-full w-full flex-col">
      <header className="flex items-center gap-2 border-border/40 border-b px-3 py-2.5">
        <SidebarTrigger />
        <span className="font-medium text-sm">Research agent</span>
        {busy ? (
          <span
            className="fade-in flex items-center gap-1.5 text-muted-foreground text-xs"
            title={agent.status}
          >
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            researching…
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
            messages.map((m) => (
              <Message className="message-fade-in" from={m.role} key={m.id}>
                <MessageContent>
                  <MessageResponse>{textOf(m)}</MessageResponse>
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {agent.error ? (
        <p className="mx-auto w-full max-w-3xl px-4 pb-2 text-destructive text-sm">
          {agent.error.message}
        </p>
      ) : null}

      <div className="mx-auto w-full max-w-3xl p-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea placeholder="Ask a research question…" />
          <PromptInputSubmit status={agent.status} />
        </PromptInput>
      </div>
    </main>
  );
}
