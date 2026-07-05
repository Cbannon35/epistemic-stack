"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";

// #-mention tokens: `#[<kind>:<nodeId>|<label>]`. Plain text end to end — the
// composer inserts it, eve reads it verbatim (the label rides along so the
// model knows what's referenced), and the renderer swaps it for an inline
// chip. Kind is display-only; the node id alone drives focus.

export type NodeRefKind = "claim" | "source" | "crux" | "hypothesis";

const KIND_GLYPH: Record<NodeRefKind, string> = {
  claim: "◇",
  source: "▤",
  crux: "◆",
  hypothesis: "✳",
};

const TOKEN_RE = /#\[(claim|source|crux|hypothesis):([^\]|]+)\|([^\]\n]*)\]/g;

/** Strip characters that would break the token's own delimiters. */
export function sanitizeRefLabel(label: string): string {
  return label
    .replace(/[[\]|\n]/g, " ")
    .trim()
    .slice(0, 80);
}

export function nodeRefToken(
  kind: NodeRefKind,
  nodeId: string,
  label: string
): string {
  return `#[${kind}:${nodeId}|${sanitizeRefLabel(label)}]`;
}

export const NODE_REF_HREF_PREFIX = "#epinode:";

/**
 * Swap tokens for markdown links so Streamdown renders them inline without
 * splitting the surrounding paragraph. Returns the input unchanged when no
 * token is present (the memoized part re-renders on the same string anyway).
 */
export function transformNodeRefs(text: string): string {
  TOKEN_RE.lastIndex = 0;
  if (!TOKEN_RE.test(text)) {
    return text;
  }
  return text.replace(
    TOKEN_RE,
    (_match, kind: string, id: string, label: string) => {
      const glyph = KIND_GLYPH[kind as NodeRefKind] ?? "◇";
      const shown = (label || id).trim();
      return `[${glyph} ${shown}](${NODE_REF_HREF_PREFIX}${encodeURIComponent(id)})`;
    }
  );
}

/**
 * Wraps rendered markdown and intercepts clicks on node-ref anchors (event
 * delegation via a native listener — anchors are natively keyboard-actionable,
 * so no JSX click handler is needed). Focusing rides the graph bus; the
 * workspace opens the graph pane on the same event.
 */
export function NodeRefText({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>(
        `a[href^="${NODE_REF_HREF_PREFIX}"]`
      );
      if (!anchor) {
        return;
      }
      event.preventDefault();
      const id = decodeURIComponent(
        anchor.getAttribute("href")?.slice(NODE_REF_HREF_PREFIX.length) ?? ""
      );
      if (id) {
        graphBus.emit("focusNode", { nodeId: id });
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  return <div ref={ref}>{children}</div>;
}
