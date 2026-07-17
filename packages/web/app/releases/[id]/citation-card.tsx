"use client";

import { CheckIcon, CopyIcon, QuoteIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { citationFor, type ReleaseRecord } from "@/lib/release-types";

// Client-side so the citation carries the real origin without opting the
// (ISR) page into per-request rendering.

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      className="flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
      type="button"
    >
      {copied ? (
        <CheckIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

export function CitationCard({ release }: { release: ReleaseRecord }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const citation = citationFor(release, origin);
  return (
    <div className="rounded-xl border border-border/60 bg-background p-4 shadow-[var(--shadow-card)]">
      <p className="mb-2 flex items-center gap-1.5 font-medium text-sm">
        <QuoteIcon className="size-4 text-muted-foreground" /> Cite this release
      </p>
      <p className="rounded-md bg-muted/60 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
        {citation.plain}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <CopyButton label="Copy citation" text={citation.plain} />
        <CopyButton label="Copy BibTeX" text={citation.bibtex} />
      </div>
    </div>
  );
}
