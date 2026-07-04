"use client";

import { useEveAgent } from "eve/react";
import { createContext, type ReactNode, useContext, useRef } from "react";
import { saveInvestigation } from "@/app/(chat)/actions";

// The eve agent session, provided to the sidebar / chat / graph. Remounted (via
// `key`) when the selected investigation changes. Persistence happens in eve
// callbacks — no effects: onSessionChange creates the investigation the moment
// the session starts, onFinish updates its snapshot for resume.
type EveAgent = ReturnType<typeof useEveAgent>;

const EveChatContext = createContext<EveAgent | null>(null);

export type SessionInitial = { session?: unknown; events?: unknown };

function firstUserText(messages: any[] | undefined): string | null {
  const first = (messages ?? []).find((m) => m.role === "user");
  if (!first) {
    return null;
  }
  const text =
    (first.parts ?? [])
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text)
      .join(" ") ||
    first.text ||
    "";
  return text.trim() || null;
}

export function EveSession({
  initial,
  onSaved,
  children,
}: {
  initial: SessionInitial;
  onSaved: () => void;
  children: ReactNode;
}) {
  const createdRef = useRef<string | null>(null);
  // Latest agent, read inside callbacks (the "latest ref" pattern — not an effect).
  const agentRef = useRef<EveAgent | null>(null);

  const agent = useEveAgent({
    initialSession: initial.session as any,
    initialEvents: initial.events as any,
    onSessionChange: (session) => {
      const sessionId = session?.sessionId;
      if (!sessionId || createdRef.current === sessionId) {
        return;
      }
      const title = firstUserText((agentRef.current?.data as any)?.messages);
      if (!title) {
        return;
      }
      createdRef.current = sessionId;
      saveInvestigation({
        sessionId,
        title,
        sessionState: session,
        events: agentRef.current?.events as unknown,
      }).then(onSaved);
    },
    onFinish: (snap) => {
      const sessionId = snap.session?.sessionId;
      const title = firstUserText((snap.data as any)?.messages);
      if (!sessionId || !title) {
        return;
      }
      saveInvestigation({
        sessionId,
        title,
        sessionState: snap.session,
        events: snap.events as unknown,
      }).then(onSaved);
    },
  });
  agentRef.current = agent;

  return (
    <EveChatContext.Provider value={agent}>{children}</EveChatContext.Provider>
  );
}

export function useEveChat(): EveAgent {
  const ctx = useContext(EveChatContext);
  if (!ctx) {
    throw new Error("useEveChat must be used within EveSession");
  }
  return ctx;
}
