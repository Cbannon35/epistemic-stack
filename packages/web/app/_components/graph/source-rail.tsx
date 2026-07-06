"use client";

import { useEffect, useState } from "react";
import type { GraphNode } from "./types";

// Rich source links (the design's evidence cards): a scrollable rail to the
// left of the overview. Each card lazy-loads its page's og:image; clicking
// opens the in-page preview instead of leaving the app.

const MAX_SOURCES = 20;

type SourceMeta = {
  image: string | null;
  description: string | null;
  site: string | null;
};

// Module cache so reopening the rail doesn't refetch every card.
const metaCache = new Map<string, SourceMeta>();

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sourceUrl(node: GraphNode): string | null {
  const url = node.detail?.url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

function useSourceMeta(url: string | null): SourceMeta | null {
  const [meta, setMeta] = useState<SourceMeta | null>(
    url ? (metaCache.get(url) ?? null) : null
  );
  useEffect(() => {
    if (!url || metaCache.has(url)) {
      return;
    }
    let cancelled = false;
    fetch(`/api/source-meta?url=${encodeURIComponent(url)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: SourceMeta | null) => {
        if (body) {
          metaCache.set(url, body);
          if (!cancelled) {
            setMeta(body);
          }
        }
      })
      .catch(() => {
        // Best-effort — the card falls back to the letter tile.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return meta;
}

function SourceCard({
  node,
  onPreview,
}: {
  node: GraphNode;
  onPreview: (node: GraphNode) => void;
}) {
  const url = sourceUrl(node);
  const meta = useSourceMeta(url);
  const host = url ? hostOf(url) : null;
  const study = Boolean(node.detail?.peer_reviewed);

  return (
    <button
      className="group w-full overflow-hidden rounded-lg border border-border/60 bg-background text-left shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-[var(--shadow-float)]"
      onClick={() => onPreview(node)}
      type="button"
    >
      {meta?.image ? (
        // biome-ignore lint/performance/noImgElement: og-images come from arbitrary source domains — next/image would need a remotePatterns allowlist per host
        <img
          alt=""
          className="h-20 w-full object-cover"
          height={80}
          loading="lazy"
          src={meta.image}
          width={224}
        />
      ) : (
        <div className="flex h-10 items-center gap-2 border-border/40 border-b bg-muted/40 px-2.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted font-semibold text-[10px] text-muted-foreground uppercase">
            {(host ?? "?").slice(0, 1)}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            {host ?? "no link"}
          </span>
        </div>
      )}
      <div className="space-y-0.5 px-2.5 py-2">
        <p className="line-clamp-2 font-medium text-xs leading-snug">
          {node.label}
        </p>
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {study ? (
            <span className="rounded border border-current border-dashed px-1 py-px">
              Study
            </span>
          ) : null}
          <span className="truncate">{host ?? "unlinked source"}</span>
        </p>
      </div>
    </button>
  );
}

export function SourceRail({
  nodes,
  onPreview,
}: {
  nodes: GraphNode[];
  onPreview: (node: GraphNode) => void;
}) {
  const sources = nodes
    .filter((n) => n.kind === "source" && sourceUrl(n))
    .slice(0, MAX_SOURCES);
  if (sources.length === 0) {
    return null;
  }
  return (
    <div className="fade-up absolute top-14 right-[21.75rem] bottom-20 z-10 w-56">
      <div className="flex max-h-full flex-col gap-2 overflow-y-auto overscroll-contain pb-1">
        {sources.map((node) => (
          <SourceCard key={node.id} node={node} onPreview={onPreview} />
        ))}
      </div>
    </div>
  );
}
