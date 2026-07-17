"use client";

import { LibraryIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";
import type { CommonsHit } from "@/lib/commons-search";

// "Prior work" strip: once a room exists, surface what OTHER investigations
// already established about its question — the compounding loop made visible.
// One fetch per room; dismissible; hidden when the commons has nothing.

const MAX_SHOWN = 3;

type Msg = {
  role: string;
  parts?: ReadonlyArray<{ type?: string; text?: string }>;
};

// The room's question = its first user message (same derivation the sidebar
// uses for just-started rooms).
function firstQuestion(messages: readonly Msg[]): string | null {
  const first = messages.find((m) => m.role === "user");
  if (!first) {
    return null;
  }
  const text = (first.parts ?? [])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join(" ");
  return text.trim() || null;
}

export function RelatedPriorWork() {
  const room = useRoom();
  const router = useRouter();
  const [hits, setHits] = useState<CommonsHit[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const roomId = room.roomId;
  const question = firstQuestion(
    (room.data as { messages?: readonly Msg[] }).messages ?? []
  );

  // Reset per room.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roomId IS the reset key
  useEffect(() => {
    setHits(null);
    setDismissed(false);
  }, [roomId]);

  useEffect(() => {
    // Blank-start rooms opted out of prior-work seeding entirely.
    if (!(roomId && question && room.seedFromCommons) || hits !== null) {
      return;
    }
    const controller = new AbortController();
    const run = async () => {
      const params = new URLSearchParams({
        q: question,
        exclude: roomId,
        mode: "or",
      });
      const search = await fetch(`/api/commons/search?${params}`, {
        signal: controller.signal,
      });
      if (!search.ok) {
        return;
      }
      const body = (await search.json()) as { hits: CommonsHit[] };
      setHits(
        body.hits
          .filter((h) => h.kind === "claim" || h.kind === "hypothesis")
          .filter((h) => h.investigationId)
          .slice(0, MAX_SHOWN)
      );
    };
    run().catch(() => {
      // Aborted or offline — the strip just doesn't show.
    });
    return () => controller.abort();
  }, [roomId, question, hits, room.seedFromCommons]);

  if (dismissed || !hits || hits.length === 0) {
    return null;
  }

  return (
    <div className="fade-up mx-auto w-full max-w-3xl px-4">
      <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2">
        <LibraryIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Prior work from the commons
          </p>
          <div className="mt-1 space-y-1">
            {hits.map((hit) => (
              <button
                className="block w-full truncate text-left text-xs transition-colors duration-150 hover:text-foreground"
                key={hit.nodeId}
                onClick={() =>
                  router.push(
                    `/i/${encodeURIComponent(hit.investigationId as string)}`
                  )
                }
                title={`${hit.text} — "${hit.investigationTitle ?? ""}"`}
                type="button"
              >
                <span className="text-muted-foreground">
                  [{hit.kind === "hypothesis" ? "hyp" : "claim"}]
                </span>{" "}
                {hit.text}
                {hit.investigationTitle ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — “{hit.investigationTitle}”
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <button
          aria-label="Dismiss prior work"
          className="rounded-md p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
