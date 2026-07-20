"use client";

import { DatabaseIcon, LoaderIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// "Load sample data": pull a bundled commons seed (data/seeds/*.json) into the
// live database via /api/commons/seed. The compounding story, one click — load
// a prior investigation's graph instead of re-running it. Idempotent server-side.

type SeedItem = {
  name: string;
  title: string;
  counts: Record<string, number> | null;
  sessionId: string | null;
  hasChat: boolean;
};

function summarize(counts: Record<string, number> | null): string {
  if (!counts) {
    return "";
  }
  const parts: string[] = [];
  if (counts.claims) {
    parts.push(`${counts.claims} claims`);
  }
  if (counts.sources) {
    parts.push(`${counts.sources} sources`);
  }
  if (counts.hypotheses) {
    parts.push(`${counts.hypotheses} hypotheses`);
  }
  return parts.join(" · ");
}

export function LoadSeedDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [seeds, setSeeds] = useState<SeedItem[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDone(null);
    setError(null);
    fetch("/api/commons/seed")
      .then((r) => r.json())
      .then((d: { seeds: SeedItem[] }) => setSeeds(d.seeds))
      .catch(() => setSeeds([]));
  }, [open]);

  const load = useCallback(
    async (name: string) => {
      setLoading(name);
      setError(null);
      try {
        const res = await fetch("/api/commons/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(d?.error ?? "load failed");
        }
        const data = (await res.json()) as {
          sessionId: string | null;
          chat: boolean;
        };
        setDone(name);
        // One click, one window: open the loaded room. Its graph renders and,
        // if the seed shipped a chat session, eve's transcript replays.
        if (data.sessionId) {
          onOpenChange(false);
          router.push(`/i/${data.sessionId}`);
        } else {
          router.refresh();
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "load failed");
      } finally {
        setLoading(null);
      }
    },
    [router, onOpenChange]
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load sample data</DialogTitle>
          <DialogDescription>
            Load a prior investigation — its claim graph and, where available,
            eve's full chat transcript — and open it in one window. Safe to
            re-run; nothing is overwritten.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {seeds === null ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : seeds.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No seeds found in data/seeds.
            </p>
          ) : (
            seeds.map((seed) => (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"
                key={seed.name}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{seed.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {summarize(seed.counts) || seed.name}
                    {seed.hasChat ? " · chat" : ""}
                  </p>
                </div>
                <Button
                  disabled={loading !== null}
                  onClick={() => load(seed.name)}
                  size="sm"
                  variant={done === seed.name ? "secondary" : "default"}
                >
                  {loading === seed.name ? (
                    <LoaderIcon className="size-4 animate-spin" />
                  ) : (
                    <DatabaseIcon className="size-4" />
                  )}
                  {done === seed.name ? "Loaded" : "Load"}
                </Button>
              </div>
            ))
          )}
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          {done ? (
            <p className="text-muted-foreground text-xs">
              Loaded. Open the graph, or find it in the commons search (⌘K).
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
