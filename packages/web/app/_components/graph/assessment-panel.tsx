"use client";

import { XIcon } from "lucide-react";
import type { Assessment } from "./types";

export function AssessmentPanel({
  assessment,
  onClose,
}: {
  assessment: Assessment;
  onClose: () => void;
}) {
  const hyps = [...assessment.hypotheses].sort(
    (a, b) => b.support - b.undermine - (a.support - a.undermine)
  );
  const max = Math.max(
    0.001,
    ...hyps.map((h) => Math.max(h.support, h.undermine))
  );

  return (
    <div className="panel-in-left absolute top-0 bottom-0 left-0 z-20 flex w-80 max-w-[80%] flex-col border-border/60 border-r bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between border-border/40 border-b px-3 py-2.5">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          State of the question
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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {hyps.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No competing hypotheses recorded yet. They appear as the agent lays
            out the rival explanations.
          </p>
        ) : (
          hyps.map((h) => (
            <div className="space-y-1.5" key={h.id}>
              <div className="flex items-start gap-2">
                <p className="flex-1 font-medium text-sm leading-snug">
                  {h.statement}
                </p>
                {h.answerBearing ? (
                  <span className="mt-0.5 shrink-0 rounded-full border border-[#7c3aed]/40 bg-[#7c3aed]/10 px-1.5 py-0.5 text-[9px] text-[#7c3aed]">
                    {h.answerBearing}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-14 text-[10px] text-muted-foreground">
                    support
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#16a34a] transition-[width] duration-300 ease-out"
                      style={{ width: `${(h.support / max) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-14 text-[10px] text-muted-foreground">
                    counter
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#dc2626] transition-[width] duration-300 ease-out"
                      style={{ width: `${(h.undermine / max) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {h.claimCount} linked claim{h.claimCount === 1 ? "" : "s"}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="border-border/40 border-t px-3 py-2.5 text-muted-foreground text-xs">
        <span className="font-medium text-foreground">
          {assessment.openCruxes}
        </span>{" "}
        open crux
        {assessment.openCruxes === 1 ? "" : "es"} drive the residual
        uncertainty. Assessment is late-binding — this is the shape of the
        evidence, not a verdict.
      </div>
    </div>
  );
}
