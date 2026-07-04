"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

// The agent's reasoning: open + shimmering while it streams, collapsed to a
// one-line disclosure when done.
export function ReasoningBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (streaming) {
    return (
      <div className="border-border/50 border-l-2 pl-2">
        <span className="shimmer text-muted-foreground text-xs">thinking…</span>
        <p className="mt-0.5 line-clamp-3 text-muted-foreground text-xs italic">
          {text}
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
        />
        thought for a moment
      </button>
      {open ? (
        <p className="mt-1 ml-4 whitespace-pre-wrap border-border/50 border-l-2 pl-2 text-muted-foreground text-xs italic">
          {text}
        </p>
      ) : null}
    </div>
  );
}
