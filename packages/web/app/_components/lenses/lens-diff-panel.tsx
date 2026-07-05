"use client";

import { XIcon } from "lucide-react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import type { Divergence } from "@/lib/lenses/evaluate";
import { LENS_A_COLOR, LENS_B_COLOR } from "./colors";
import type { LensDiffState } from "./use-lenses";

const SHOW_LIMIT = 10;
const MIN_DELTA = 0.02;

// The multiplayer payoff of late-binding trust: two lenses, one graph, and a
// ranked list of exactly where the worldviews part.
export function LensDiffPanel({
  diff,
  divergences,
  onClose,
}: {
  diff: LensDiffState;
  divergences: Divergence[];
  onClose: () => void;
}) {
  const parting = divergences
    .filter((d) => Math.abs(d.delta) >= MIN_DELTA)
    .slice(0, SHOW_LIMIT);

  return (
    <div className="fade-in absolute right-3 bottom-3 z-10 flex max-h-72 w-72 flex-col rounded-md border border-border/50 bg-background/90 backdrop-blur">
      <div className="flex items-center justify-between border-border/40 border-b px-2.5 py-2">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Where you part ways
        </span>
        <button
          aria-label="Stop comparing"
          className="-m-1 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {parting.length === 0 ? (
          <p className="px-1.5 py-2 text-muted-foreground text-xs">
            These lenses agree on everything in view.
          </p>
        ) : (
          parting.map((d) => (
            <button
              className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
              key={d.node.id}
              onClick={() => graphBus.emit("focusNode", { nodeId: d.node.id })}
              type="button"
            >
              <span
                className="mt-1 size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: d.delta > 0 ? LENS_A_COLOR : LENS_B_COLOR,
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs leading-snug">
                  {d.node.label}
                </span>
                <span className="block text-[10px] text-muted-foreground tabular-nums">
                  {Math.round(d.scoreA * 100)}% vs {Math.round(d.scoreB * 100)}%
                  · {d.node.kind}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      <div className="flex items-center gap-3 border-border/40 border-t px-2.5 py-1.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: LENS_A_COLOR }}
          />
          {diff.a.name} trusts more
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: LENS_B_COLOR }}
          />
          {diff.b.name}
        </span>
      </div>
    </div>
  );
}
