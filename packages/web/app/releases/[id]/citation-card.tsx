"use client";

import { QuoteIcon } from "lucide-react";
import { CopyChip, useOrigin } from "@/app/_components/ui/copy-chip";
import { citationFor, type ReleaseRecord } from "@/lib/release-types";

// Client-side so the citation carries the real origin without opting the
// (ISR) page into per-request rendering.

export function CitationCard({ release }: { release: ReleaseRecord }) {
  const origin = useOrigin();
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
        <CopyChip label="Copy citation" text={citation.plain} />
        <CopyChip label="Copy BibTeX" text={citation.bibtex} />
      </div>
    </div>
  );
}
