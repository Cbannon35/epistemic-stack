"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

// The one copy-to-clipboard chip (older per-feature copies predate it; new
// surfaces should use this).

export function CopyChip({ text, label }: { text: string; label?: string }) {
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
      aria-label={label ?? "Copy"}
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
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

/** window.location.origin after mount — hydration-safe ("" during SSR). */
export function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  return origin;
}
