"use client";

import { ExternalLinkIcon, XIcon } from "lucide-react";
import { CredenceSection } from "./credence-section";
import type { CredenceDetail, GraphNode, Mention } from "./types";

const KIND_LABEL: Record<string, string> = {
  claim: "Claim",
  source: "Source",
  crux: "Crux",
  hypothesis: "Hypothesis",
};

function Chip({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return (
    <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
      {label}: <span className="text-foreground">{String(value)}</span>
    </span>
  );
}

export function Inspector({
  node,
  sourceById,
  onClose,
}: {
  node: GraphNode;
  sourceById: Map<string, { label: string; url?: string | null }>;
  onClose: () => void;
}) {
  const d = (node.detail ?? {}) as Record<string, unknown>;
  const mentions = (d.mentions ?? []) as Mention[];

  return (
    <div className="panel-in-right absolute top-0 right-0 bottom-0 z-20 flex w-80 max-w-[80%] flex-col border-border/60 border-l bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between border-border/40 border-b px-3 py-2.5">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {KIND_LABEL[node.kind] ?? node.kind}
        </span>
        <button
          aria-label="Close"
          className="-m-1 rounded-md p-1 text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-95 active:bg-muted active:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        <p className="whitespace-pre-wrap font-medium leading-snug">
          {node.label}
        </p>

        {node.kind === "claim" ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="position" value={d.position} />
              <Chip label="discipline" value={d.discipline} />
              <Chip label="evidence" value={d.evidence_type} />
              <Chip label="era" value={d.era} />
              <Chip label="modality" value={d.modality} />
            </div>
            <div>
              <p className="mb-1.5 font-medium text-muted-foreground text-xs">
                Sources ({mentions.length})
              </p>
              <div className="space-y-2.5">
                {mentions.map((m) => {
                  const src = sourceById.get(m.sourceId);
                  return (
                    <div
                      className="rounded-md border border-border/50 p-2"
                      key={`${m.sourceId}-${m.quote}`}
                    >
                      <div className="mb-1 flex items-center gap-1 text-muted-foreground text-xs">
                        {src?.url ? (
                          <a
                            className="inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground hover:underline"
                            href={src.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {src.label} <ExternalLinkIcon className="size-3" />
                          </a>
                        ) : (
                          (src?.label ?? "source")
                        )}
                      </div>
                      <p className="text-foreground/80 text-xs italic">
                        “{m.quote}”
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {node.kind === "source" ? (
          <div className="flex flex-wrap gap-1.5">
            <Chip label="venue" value={d.venue} />
            <Chip label="author" value={d.author} />
            <Chip label="date" value={d.date} />
            {d.peer_reviewed ? (
              <Chip label="peer-reviewed" value="yes" />
            ) : null}
            {d.url ? (
              <a
                className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] transition-colors duration-150 hover:bg-muted"
                href={d.url as string}
                rel="noreferrer"
                target="_blank"
              >
                open <ExternalLinkIcon className="size-3" />
              </a>
            ) : null}
          </div>
        ) : null}

        {node.kind === "crux" ? (
          <div className="space-y-2">
            {d.implication ? (
              <p className="text-muted-foreground text-xs">
                <span className="font-medium">If resolved:</span>{" "}
                {String(d.implication)}
              </p>
            ) : null}
            <Chip label="status" value={d.status} />
          </div>
        ) : null}

        {node.kind === "hypothesis" ? (
          <>
            {d.answer_bearing ? (
              <Chip label="answers" value={d.answer_bearing} />
            ) : null}
            <CredenceSection
              credence={(d.credence as CredenceDetail | null) ?? null}
              hypothesisId={String(d.hypothesis_id ?? node.id.slice(4))}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
