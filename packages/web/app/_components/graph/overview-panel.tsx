"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { graphBus } from "./graph-bus";
import { KIND_PILL } from "./nodes";
import type { GraphData, GraphNode, Mention } from "./types";

// The design's "structured overview instead of just the graph": a floating
// menu — hypothesis card on top, then an accordion of Claims / Cruxes /
// Sources / Studies. Rows expand in place; items focus their graph node.

type SectionKey = "claims" | "cruxes" | "sources" | "studies";

function pillStyle(kind: keyof typeof KIND_PILL) {
  const pill = KIND_PILL[kind];
  return { background: pill.bg, color: pill.fg };
}

function findingsOf(node: GraphNode): string[] {
  const mentions = (node.detail?.mentions ?? []) as Mention[];
  return mentions.slice(0, 2).map((m) => m.quote);
}

function Section({
  count,
  open,
  onToggle,
  badge,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <div className="border-border/40 border-t first:border-t-0">
      <button
        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/50"
        onClick={onToggle}
        type="button"
      >
        {badge}
        <PlusIcon
          className={`size-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-45" : ""}`}
        />
      </button>
      {open ? (
        <div className="max-h-72 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function GhostBadge({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
      <span
        className="inline-block size-2.5 border-[1.5px] border-current border-dashed"
        style={{ borderRadius: label === "Studies" ? 3 : 999 }}
      />
      {count} {label}
    </span>
  );
}

function focus(nodeId: string) {
  graphBus.emit("focusNode", { nodeId });
}

export function OverviewPanel({
  data,
  question,
  onClose,
}: {
  data: GraphData;
  question: string | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<SectionKey | null>("claims");
  const toggle = (key: SectionKey) =>
    setOpen((cur) => (cur === key ? null : key));

  const claims = data.nodes.filter((n) => n.kind === "claim");
  const cruxes = data.nodes.filter((n) => n.kind === "crux");
  const sources = data.nodes.filter(
    (n) => n.kind === "source" && !n.detail?.peer_reviewed
  );
  const studies = data.nodes.filter(
    (n) => n.kind === "source" && Boolean(n.detail?.peer_reviewed)
  );
  const hypothesis = data.nodes.find((n) => n.kind === "hypothesis");
  const heading = question ?? hypothesis?.label ?? "This investigation";

  const itemButton =
    "block w-full rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-muted/60";

  return (
    <div className="fade-up pointer-events-auto absolute top-14 right-3 z-10 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2">
      <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-background/95 p-3 shadow-[var(--shadow-float)] backdrop-blur">
        <span
          className="shrink-0 rounded-md px-2 py-0.5 font-semibold text-[10px]"
          style={pillStyle("hypothesis")}
        >
          Hypothesis
        </span>
        <p className="min-w-0 flex-1 text-pretty font-medium text-sm leading-snug">
          {heading}
        </p>
        <button
          aria-label="Close overview"
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="rounded-xl border border-border/60 bg-background/95 shadow-[var(--shadow-float)] backdrop-blur">
        <Section
          badge={
            <span
              className="rounded-md px-2 py-0.5 font-semibold text-[11px]"
              style={pillStyle("claim")}
            >
              {claims.length} Claims
            </span>
          }
          count={claims.length}
          onToggle={() => toggle("claims")}
          open={open === "claims"}
        >
          {claims.map((claim) => (
            <button
              className={itemButton}
              key={claim.id}
              onClick={() => focus(claim.id)}
              type="button"
            >
              <span className="block font-medium text-xs leading-snug">
                {claim.label}
              </span>
              {findingsOf(claim).map((quote) => (
                <span
                  className="mt-1 block border-border/60 border-l-2 pl-2 text-[11px] text-muted-foreground leading-snug"
                  key={quote.slice(0, 40)}
                >
                  {quote}
                </span>
              ))}
            </button>
          ))}
        </Section>

        <Section
          badge={
            <span
              className="rounded-md px-2 py-0.5 font-semibold text-[11px]"
              style={pillStyle("crux")}
            >
              {cruxes.length} Cruxes
            </span>
          }
          count={cruxes.length}
          onToggle={() => toggle("cruxes")}
          open={open === "cruxes"}
        >
          {cruxes.map((crux) => (
            <button
              className={itemButton}
              key={crux.id}
              onClick={() => focus(crux.id)}
              type="button"
            >
              <span className="block text-xs leading-snug">{crux.label}</span>
            </button>
          ))}
        </Section>

        <Section
          badge={<GhostBadge count={sources.length} label="Sources" />}
          count={sources.length}
          onToggle={() => toggle("sources")}
          open={open === "sources"}
        >
          {sources.map((source) => (
            <button
              className={itemButton}
              key={source.id}
              onClick={() => focus(source.id)}
              type="button"
            >
              <span className="block truncate text-muted-foreground text-xs">
                {source.label}
              </span>
            </button>
          ))}
        </Section>

        <Section
          badge={<GhostBadge count={studies.length} label="Studies" />}
          count={studies.length}
          onToggle={() => toggle("studies")}
          open={open === "studies"}
        >
          {studies.map((study) => (
            <button
              className={itemButton}
              key={study.id}
              onClick={() => focus(study.id)}
              type="button"
            >
              <span className="block truncate text-muted-foreground text-xs">
                {study.label}
              </span>
            </button>
          ))}
        </Section>
      </div>
    </div>
  );
}
