"use client";

import { MicroscopeIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  DelegationsApi,
  LiveLine,
} from "@/app/_components/delegate/use-delegations";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useRoom } from "@/app/_components/room-provider";
import type { DelegationSummary } from "@/lib/delegate/types";
import { DELEGATE_COLOR } from "@/lib/realtime/color";

// The investigations dock (top-right of the graph): every delegated eve run in
// this room — live narration while one crawls, the summary once it lands, a
// composer to assign a new one, and cancel for your own. Peers' runs appear
// here too, fed by the same broadcasts that drive their cursors.

const BRIEF_MAX = 400;

const STATUS_LABEL: Record<string, string> = {
  cancelled: "cancelled",
  interrupted: "interrupted — the delegator left mid-run",
  error: "eve hit an error mid-run",
};

function ActivityLine({
  row,
  line,
}: {
  row: DelegationSummary;
  line: LiveLine | undefined;
}) {
  if (row.status === "running" || line) {
    return (
      <p className="mt-0.5 animate-pulse text-[11px] text-muted-foreground">
        {line?.narration ?? "working…"}
      </p>
    );
  }
  if (row.status === "completed") {
    return (
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {row.summary ?? "done"}
      </p>
    );
  }
  return (
    <p className="mt-0.5 text-[11px] text-muted-foreground/70 italic">
      {STATUS_LABEL[row.status] ?? row.status}
    </p>
  );
}

function StatusDot({ status }: { status: DelegationSummary["status"] }) {
  if (status === "running") {
    return (
      <span
        className="mt-1 inline-block size-1.5 shrink-0 animate-pulse rounded-full"
        style={{ backgroundColor: DELEGATE_COLOR }}
      />
    );
  }
  return (
    <span
      className={`mt-1 inline-block size-1.5 shrink-0 rounded-full ${
        status === "completed" ? "bg-emerald-500/80" : "bg-muted-foreground/40"
      }`}
    />
  );
}

export function DelegationDock({
  delegations,
}: {
  delegations: DelegationsApi;
}) {
  const { me, roomId } = useRoom();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { rows, live, pending, error, start, cancel } = delegations;

  // The chat header's Delegate button lands here: open with the composer ready.
  useEffect(
    () =>
      graphBus.on("openDelegate", () => {
        setOpen(true);
        // Wait for the panel to mount before grabbing focus.
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    []
  );

  // Presence of the dock follows the room: a fresh, unsent chat has nothing to
  // delegate against yet.
  if (!roomId) {
    return null;
  }

  const runningCount =
    rows.filter((r) => r.status === "running").length + (pending ? 1 : 0);

  const submit = () => {
    const brief = draft.trim();
    if (!brief) {
      return;
    }
    setDraft("");
    start(brief).catch(() => {
      // start() surfaces its own error state.
    });
  };

  return (
    <div className="pointer-events-auto absolute top-12 right-3 z-20 flex w-72 max-w-[calc(100%-1.5rem)] flex-col items-end">
      <button
        className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/90 px-2.5 py-1 text-muted-foreground text-xs shadow-[var(--shadow-float)] backdrop-blur transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97]"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <MicroscopeIcon
          className="size-3.5"
          style={{ color: DELEGATE_COLOR }}
        />
        investigations
        {runningCount > 0 ? (
          <span
            className="inline-block size-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: DELEGATE_COLOR }}
          />
        ) : null}
      </button>

      {open ? (
        <div className="fade-up mt-2 w-full rounded-lg border border-border/60 bg-background/95 shadow-[var(--shadow-float)] backdrop-blur">
          <div className="max-h-72 overflow-y-auto p-1">
            {pending ? (
              <div className="flex items-start gap-2 rounded-md px-2 py-1.5">
                <StatusDot status="running" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground text-xs">
                    {pending}
                  </p>
                  <p className="mt-0.5 animate-pulse text-[11px] text-muted-foreground">
                    eve is planning the run…
                  </p>
                </div>
              </div>
            ) : null}
            {rows.map((row) => (
              <div
                className="group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-muted/50"
                key={row.id}
              >
                <StatusDot status={row.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground text-xs leading-snug">
                    {row.brief}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                    delegated by{" "}
                    {row.delegatorId === me.userId
                      ? "you"
                      : row.delegatorName.split("@")[0]}
                  </p>
                  <ActivityLine line={live.get(row.id)} row={row} />
                </div>
                {row.status === "running" && row.delegatorId === me.userId ? (
                  <button
                    aria-label="Cancel this investigation"
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground group-hover:opacity-100"
                    onClick={() => cancel(row.id)}
                    title="Cancel"
                    type="button"
                  >
                    <XIcon className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
            {rows.length === 0 && !pending ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                Assign eve a sub-investigation — she'll work the graph while you
                keep talking.
              </p>
            ) : null}
          </div>
          <div className="border-border/50 border-t p-1.5">
            <input
              className="w-full rounded-md border border-border/50 bg-background px-2 py-1 text-foreground text-xs outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring"
              maxLength={BRIEF_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="eve, investigate…"
              ref={inputRef}
              type="text"
              value={draft}
            />
            {error ? (
              <p className="mt-1 px-0.5 text-[11px] text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
