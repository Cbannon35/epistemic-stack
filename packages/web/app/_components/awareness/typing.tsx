"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";

// Composer typing presence: senders throttle a "typing" broadcast per
// keystroke burst; receivers expire entries after a short silence. Distinct
// from "turn:pending"/streaming — this covers the gap BEFORE a send lands,
// and the line hides the moment a turn takes over.

const SEND_EVERY_MS = 1500;
const EXPIRE_MS = 4000;

export function useTypingPresence(): {
  noteTyping: () => void;
  typers: string[];
} {
  const room = useRoom();
  const { channel, me } = room;
  const { on, send } = channel;
  const [typers, setTypers] = useState<
    ReadonlyMap<string, { displayName: string; at: number }>
  >(new Map());
  const lastSentRef = useRef(0);

  const noteTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < SEND_EVERY_MS) {
      return;
    }
    lastSentRef.current = now;
    send("typing", {
      clientId: me.clientId,
      userId: me.userId,
      displayName: me.displayName,
      ts: now,
    });
  }, [send, me.clientId, me.userId, me.displayName]);

  useEffect(
    () =>
      on("typing", (p) => {
        if (p.userId === me.userId) {
          return;
        }
        setTypers((prev) =>
          new Map(prev).set(p.userId, {
            displayName: p.displayName,
            // Local receipt time — sender clocks aren't trusted.
            at: Date.now(),
          })
        );
      }),
    [on, me.userId]
  );

  // Expire quiet typists.
  useEffect(() => {
    const timer = setInterval(() => {
      setTypers((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [userId, entry] of next) {
          if (now - entry.at > EXPIRE_MS) {
            next.delete(userId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return {
    noteTyping,
    typers: [...typers.values()].map((t) => t.displayName.split("@")[0]),
  };
}

/** The reserved one-line slot above the composer — constant height, no jump. */
export function TypingLine({
  typers,
  hidden,
}: {
  typers: string[];
  hidden: boolean;
}) {
  let text = "";
  if (!hidden && typers.length === 1) {
    text = `${typers[0]} is typing…`;
  } else if (!hidden && typers.length === 2) {
    text = `${typers[0]} and ${typers[1]} are typing…`;
  } else if (!hidden && typers.length > 2) {
    text = `${typers[0]} and ${typers.length - 1} others are typing…`;
  }
  return (
    <p
      aria-live="polite"
      className="h-4 truncate px-1 text-[10px] text-muted-foreground/80"
    >
      {text ? <span className="fade-in">{text}</span> : null}
    </p>
  );
}
