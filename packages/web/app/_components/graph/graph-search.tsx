"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { graphBus } from "./graph-bus";
import { KIND_PILL } from "./nodes";
import type { GraphNode } from "./types";

// The graph's resident search bar — bottom of the pane on every screen
// (split and fullscreen). Matches node labels in the loaded scope; results
// open upward; a hit flies the camera to its node. "Search the commons"
// widens the scope and focuses this bar.

const MAX_HITS = 12;
const MIN_QUERY = 2;

function kindBadge(kind: GraphNode["kind"], study: boolean) {
  const pill = KIND_PILL[kind === "source" ? "source" : kind];
  const ghost = pill.bg === "transparent";
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 font-semibold text-[9px] ${ghost ? "border border-current border-dashed" : ""}`}
      style={{
        background: ghost ? undefined : pill.bg,
        color: pill.fg,
      }}
    >
      {kind === "source" && study ? "Study" : pill.label}
    </span>
  );
}

export function GraphSearchBar({
  nodes,
  commonsMode,
  onExitCommons,
}: {
  nodes: GraphNode[];
  /** Whole-commons scope is active — show the chip that exits it. */
  commonsMode: boolean;
  onExitCommons: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The sidebar's "Search the commons" lands the cursor right here.
  useEffect(
    () =>
      graphBus.on("openCommonsSearch", () => {
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    []
  );

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < MIN_QUERY) {
      return [];
    }
    const out: GraphNode[] = [];
    for (const n of nodes) {
      if (n.label.toLowerCase().includes(q)) {
        out.push(n);
        if (out.length >= MAX_HITS) {
          break;
        }
      }
    }
    return out;
  }, [nodes, query]);

  const open = query.trim().length >= MIN_QUERY;

  return (
    <div className="absolute right-0 bottom-0 left-0 z-10 border-border/40 border-t bg-background/85 backdrop-blur">
      {open ? (
        <div className="absolute right-3 bottom-full left-3 mb-1.5">
          <div className="fade-up mx-auto max-w-xl rounded-xl border border-border/60 bg-background/95 shadow-[var(--shadow-float)] backdrop-blur">
            {hits.length > 0 ? (
              <div className="max-h-80 overflow-y-auto overscroll-contain p-1">
                {hits.map((n) => (
                  <button
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
                    key={n.id}
                    onClick={() => graphBus.emit("focusNode", { nodeId: n.id })}
                    type="button"
                  >
                    {kindBadge(n.kind, Boolean(n.detail?.peer_reviewed))}
                    <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-snug">
                      {n.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-2.5 text-muted-foreground text-xs">
                Nothing recorded on that yet.
              </p>
            )}
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex max-w-xl items-center gap-2 px-3 py-2">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          placeholder={
            commonsMode
              ? "Search the whole commons — claims, sources, cruxes…"
              : "Search this investigation's graph…"
          }
          ref={inputRef}
          value={query}
        />
        {commonsMode ? (
          <button
            className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] text-foreground transition-colors duration-150 hover:bg-muted/70"
            onClick={() => {
              setQuery("");
              onExitCommons();
            }}
            title="Back to this investigation's scope"
            type="button"
          >
            ◈ whole commons
            <XIcon className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
