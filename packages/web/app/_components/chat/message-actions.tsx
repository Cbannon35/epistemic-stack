"use client";

import { CheckIcon, CopyIcon, GitForkIcon } from "lucide-react";
import { useEffect, useState } from "react";

// Per-response action row under each assistant message. Buttons are icon-only
// on purpose: comment anchors match quotes against the message element's
// textContent, so the toolbar must not add any text nodes.

const COPIED_MS = 1600;

const BUTTON_CLASS =
  "rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground";

export function MessageActionsBar({
  text,
  onFork,
  forkPending = false,
}: {
  text: string;
  onFork?: () => void;
  forkPending?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="-mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 group-data-last:opacity-100">
      {text ? (
        <button
          aria-label="Copy response"
          className={BUTTON_CLASS}
          onClick={() => {
            navigator.clipboard.writeText(text).then(() => setCopied(true));
          }}
          title={copied ? "Copied" : "Copy response"}
          type="button"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
      ) : null}
      {onFork ? (
        <button
          aria-label="Fork investigation"
          className={BUTTON_CLASS}
          disabled={forkPending}
          onClick={onFork}
          title="Fork — branch the investigation from this response (transcript and graph up to here)"
          type="button"
        >
          <GitForkIcon
            className={forkPending ? "size-3.5 animate-pulse" : "size-3.5"}
          />
        </button>
      ) : null}
    </div>
  );
}
