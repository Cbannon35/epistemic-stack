"use client";

import { HistoryIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";
import { getRoomDigest, type RoomDigest } from "@/app/(chat)/awareness-actions";

// "While you were away" — shown once per room visit when the viewer returns
// after a meaningful absence. Last-seen lives in localStorage per room+user;
// the digest itself is one server action call.

const AWAY_THRESHOLD_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 60_000;

const lastSeenKey = (roomId: string, userId: string) =>
  `epistack-last-seen:${roomId}:${userId}`;

function phrase(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

function digestParts(d: RoomDigest): string[] {
  const parts: string[] = [];
  if (d.turns > 0) {
    parts.push(`${phrase(d.turns, "question")} asked`);
  }
  const growth: string[] = [];
  if (d.claims > 0) {
    growth.push(phrase(d.claims, "claim"));
  }
  if (d.sources > 0) {
    growth.push(phrase(d.sources, "source"));
  }
  if (d.relations > 0) {
    growth.push(phrase(d.relations, "relation"));
  }
  if (d.cruxes > 0) {
    growth.push(phrase(d.cruxes, "crux", "cruxes"));
  }
  if (d.hypotheses > 0) {
    growth.push(phrase(d.hypotheses, "hypothesis", "hypotheses"));
  }
  if (growth.length > 0) {
    parts.push(`${growth.join(", ")} added`);
  }
  if (d.disputes > 0) {
    parts.push(phrase(d.disputes, "dispute entry", "dispute entries"));
  }
  if (d.credences > 0) {
    parts.push(phrase(d.credences, "credence update"));
  }
  if (d.comments > 0) {
    parts.push(phrase(d.comments, "comment"));
  }
  if (d.delegationsCompleted > 0) {
    parts.push(`${phrase(d.delegationsCompleted, "delegated run")} finished`);
  }
  return parts;
}

export function CatchUpDigest() {
  const room = useRoom();
  const { roomId, me } = room;
  const [digest, setDigest] = useState<RoomDigest | null>(null);

  useEffect(() => {
    if (!roomId) {
      return;
    }
    const key = lastSeenKey(roomId, me.userId);
    // Read BEFORE the first heartbeat write — order matters here.
    const stored = Number(localStorage.getItem(key) ?? 0);
    if (stored > 0 && Date.now() - stored > AWAY_THRESHOLD_MS) {
      getRoomDigest({ sessionId: roomId, since: stored })
        .then((d) => {
          if (d && digestParts(d).length > 0) {
            setDigest(d);
          }
        })
        .catch(() => {
          // Awareness only — a failed digest is silently skipped.
        });
    }
    const write = () => localStorage.setItem(key, String(Date.now()));
    write();
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible") {
        write();
      }
    }, HEARTBEAT_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        write();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", write);
    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", write);
      write();
    };
  }, [roomId, me.userId]);

  if (!digest) {
    return null;
  }

  return (
    <div className="fade-in mb-1 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs">
      <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium">While you were away</span>
      <span className="truncate text-muted-foreground">
        {digestParts(digest).join(" · ")}
      </span>
      <button
        className="ml-auto rounded-md p-0.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        onClick={() => setDigest(null)}
        title="Dismiss"
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
