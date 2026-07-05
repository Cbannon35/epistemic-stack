"use client";

import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";
import { colorForUser } from "@/lib/realtime/color";
import type { ViewSharedEvent } from "@/lib/realtime/types";

// Shared views: a member captures their current graph framing (filters, lens,
// camera, selection) under a name; everyone in the room gets it as a chip and
// one click re-frames their own graph the same way. Ephemeral by design —
// broadcast to the room, remembered locally (localStorage per room), never
// written into the eve transcript.

export type ViewSnapshot = Pick<
  ViewSharedEvent,
  "filters" | "lensId" | "camera" | "selectedId"
>;

const MAX_VIEWS = 12;

const pillClass =
  "rounded-full border px-2 py-0.5 text-[10px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] active:bg-muted";

function storageKey(roomId: string | null): string {
  return `epistack-views:${roomId ?? "commons"}`;
}

function loadStored(roomId: string | null): ViewSharedEvent[] {
  try {
    const raw = window.localStorage.getItem(storageKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as ViewSharedEvent[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-MAX_VIEWS) : [];
  } catch {
    return [];
  }
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) {
    return "now";
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m`;
  }
  return `${Math.floor(s / 3600)}h`;
}

export function ViewsTray({
  roomId,
  capture,
  apply,
}: {
  roomId: string | null;
  capture: () => ViewSnapshot | null;
  apply: (view: ViewSharedEvent) => void;
}) {
  const { channel, me } = useRoom();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<ViewSharedEvent[]>([]);
  const [name, setName] = useState("");
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const { on, send } = channel;

  useEffect(() => {
    setViews(loadStored(roomId));
  }, [roomId]);

  const persist = (next: ViewSharedEvent[]) => {
    setViews(next);
    try {
      window.localStorage.setItem(storageKey(roomId), JSON.stringify(next));
    } catch {
      // Storage full/blocked — the in-memory list still works this session.
    }
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(
    () =>
      on("view-shared", (view) => {
        const current = loadStored(roomId).filter((v) => v.id !== view.id);
        persistRef.current([...current, view].slice(-MAX_VIEWS));
      }),
    [on, roomId]
  );

  // Click outside closes the panel.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const share = () => {
    const snapshot = capture();
    const trimmed = name.trim().slice(0, 60);
    if (!(snapshot && trimmed)) {
      return;
    }
    const view: ViewSharedEvent = {
      ...snapshot,
      id: crypto.randomUUID(),
      clientId: me.clientId,
      userId: me.userId,
      displayName: me.displayName,
      color: colorForUser(me.userId),
      name: trimmed,
      ts: Date.now(),
    };
    send("view-shared", view);
    persist([...views.filter((v) => v.id !== view.id), view].slice(-MAX_VIEWS));
    setName("");
  };

  const remove = (id: string) => {
    persist(views.filter((v) => v.id !== id));
  };

  const ordered = [...views].sort((a, b) => b.ts - a.ts);

  return (
    <span className="relative" ref={wrapRef}>
      <button
        className={`${pillClass} ${
          open
            ? "border-border bg-muted text-foreground"
            : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        onClick={() => setOpen((v) => !v)}
        title="Share the way you're looking at the graph — filters, lens, camera"
        type="button"
      >
        ◫ views{views.length > 0 ? ` ${views.length}` : ""}
      </button>
      {open ? (
        <div className="fade-in absolute top-full left-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-border/60 bg-background/95 shadow-[var(--shadow-float)] backdrop-blur">
          <div className="max-h-56 overflow-y-auto">
            {ordered.length === 0 ? (
              <p className="p-3 text-[11px] text-muted-foreground">
                No shared views yet — frame the graph and share how you see it.
              </p>
            ) : (
              ordered.map((view) => (
                <div
                  className="group flex w-full items-center gap-2 border-border/30 border-b px-2.5 py-1.5 last:border-b-0 hover:bg-muted/60"
                  key={view.id}
                >
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    onClick={() => {
                      apply(view);
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: view.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground text-xs">
                        {view.name}
                      </span>
                      <span className="block truncate text-[9px] text-muted-foreground">
                        {view.displayName.split("@")[0]} · {timeAgo(view.ts)}
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label="Remove view"
                    className="cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground group-hover:opacity-100"
                    onClick={() => remove(view.id)}
                    type="button"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-1.5 border-border/40 border-t p-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground"
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  share();
                }
              }}
              placeholder="Name this view…"
              value={name}
            />
            <button
              className="shrink-0 rounded-md bg-foreground px-2 py-1 text-[11px] text-background transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              disabled={!name.trim()}
              onClick={share}
              type="button"
            >
              Share
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
