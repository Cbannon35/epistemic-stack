"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { graphBus } from "./graph-bus";
import { KIND_PILL } from "./nodes";
import type { GraphNode } from "./types";

// Floating search over the loaded (whole-commons) graph: match node labels,
// click a hit to focus it. Client-side — the commons payload is already here.

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
  onClose,
}: {
  nodes: GraphNode[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

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

  return (
    <div className="-translate-x-1/2 fade-up absolute top-14 left-1/2 z-20 w-[min(30rem,90%)]">
      <div className="rounded-xl border border-border/60 bg-background/95 shadow-[var(--shadow-float)] backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            // Opened by an explicit "Search the commons" action — focus is
            // the entire point, like a command palette.
            // biome-ignore lint/a11y/noAutofocus: intentional, see above
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Search the whole commons — claims, sources, cruxes…"
            value={query}
          />
          <button
            aria-label="Close search"
            className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        {hits.length > 0 ? (
          <div className="max-h-80 overflow-y-auto overscroll-contain border-border/40 border-t p-1">
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
        ) : query.trim().length >= MIN_QUERY ? (
          <p className="border-border/40 border-t px-3 py-2.5 text-muted-foreground text-xs">
            Nothing recorded on that yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
