"use client";

import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { sourceUrl } from "./source-rail";
import type { GraphNode } from "./types";

// The design's in-page source preview: a large embedded view of the source
// so you can skim everything without opening tabs. Some sites refuse to be
// embedded (frame-ancestors) — the header's "Go to website" always works.

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourcePreview({
  node,
  onClose,
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  const url = sourceUrl(node);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!url) {
    return null;
  }
  const host = hostOf(url);

  return (
    <div className="absolute inset-0 z-30">
      <button
        aria-label="Close preview"
        className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        type="button"
      />
      <div className="fade-up -translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex h-[min(85%,52rem)] w-[min(64rem,94%)] flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[var(--shadow-float)]">
        <div className="flex items-center gap-3 border-border/40 border-b px-4 py-2.5">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
            {host.split(".")[0]}
          </span>
          <p className="min-w-0 flex-1 truncate font-medium text-sm">
            {node.label}
          </p>
          <a
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            Go to website <ExternalLinkIcon className="size-3" />
          </a>
          <button
            aria-label="Close preview"
            className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 bg-white">
          {/* Behind the iframe: shows through when the site refuses embedding. */}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="max-w-sm text-center text-muted-foreground text-sm">
              {host} won't load here? Some sites refuse embedding — use "Go to
              website" above.
            </p>
          </div>
          <iframe
            className="relative h-full w-full"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            src={url}
            title={node.label}
          />
        </div>
      </div>
    </div>
  );
}
