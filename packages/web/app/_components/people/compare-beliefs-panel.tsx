"use client";

import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useRoom } from "@/app/_components/room-provider";
import { getBeliefComparison } from "@/app/(chat)/people-actions";
import type { BeliefComparison } from "@/lib/people";
import { colorForUser } from "@/lib/realtime/color";
import type { CompareTarget } from "./people-bus";

const SHOW_LIMIT = 10;
const MIN_GAP = 0.02;

// Person-vs-person crux finding: both people's latest credences, ranked by
// gap. The widest gap is the crux — the hypothesis to talk about first.
// Sibling of the lens-diff panel: lenses compare trust rules, this compares
// registered belief.
export function CompareBeliefsPanel({
  target,
  onClose,
}: {
  target: CompareTarget;
  onClose: () => void;
}) {
  const { me } = useRoom();
  const [comparison, setComparison] = useState<BeliefComparison | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setComparison(null);
    setFailed(false);
    getBeliefComparison(target.contributorId)
      .then((result) => {
        if (result) {
          setComparison(result);
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
  }, [target.contributorId]);

  const myColor = colorForUser(me.userId);
  const theirColor = colorForUser(target.contributorId);
  const theirName = target.displayName.split("@")[0];
  const rows = (comparison?.rows ?? []).slice(0, SHOW_LIMIT);
  const crux = rows.find((r) => r.gap >= MIN_GAP);

  return (
    <div className="fade-in absolute right-3 bottom-3 z-10 flex max-h-72 w-72 flex-col rounded-md border border-border/50 bg-background/90 backdrop-blur">
      <div className="flex items-center justify-between border-border/40 border-b px-2.5 py-2">
        <span className="truncate font-medium text-muted-foreground text-xs uppercase tracking-wide">
          You vs {theirName}
        </span>
        <button
          aria-label="Stop comparing beliefs"
          className="-m-1 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {comparison === null && !failed ? (
          <p className="px-1.5 py-2 text-muted-foreground text-xs">
            Lining up your credences…
          </p>
        ) : null}
        {failed ? (
          <p className="px-1.5 py-2 text-muted-foreground text-xs">
            Couldn't load the comparison.
          </p>
        ) : null}
        {comparison && rows.length === 0 ? (
          <p className="px-1.5 py-2 text-muted-foreground text-xs">
            No hypotheses you've both weighed in on yet — register credences in
            the inspector.
          </p>
        ) : null}
        {rows.map((row) => (
          <button
            className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
            key={row.hypothesisId}
            onClick={() =>
              graphBus.emit("focusNode", { nodeId: `hyp:${row.hypothesisId}` })
            }
            type="button"
          >
            <span
              className="mt-1 size-2 shrink-0 rounded-full"
              style={{
                backgroundColor: row.mine > row.theirs ? myColor : theirColor,
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs leading-snug">
                {row.statement}
                {crux && row.hypothesisId === crux.hypothesisId ? (
                  <span className="text-muted-foreground"> · your crux</span>
                ) : null}
              </span>
              <span className="block text-[10px] text-muted-foreground tabular-nums">
                you {Math.round(row.mine * 100)}% · {theirName}{" "}
                {Math.round(row.theirs * 100)}%
              </span>
            </span>
          </button>
        ))}
      </div>

      {comparison && (comparison.onlyMine > 0 || comparison.onlyTheirs > 0) ? (
        <div className="border-border/40 border-t px-2.5 py-1.5 text-[10px] text-muted-foreground">
          {comparison.onlyMine > 0
            ? `${theirName} hasn't rated ${comparison.onlyMine} you have`
            : null}
          {comparison.onlyMine > 0 && comparison.onlyTheirs > 0 ? " · " : null}
          {comparison.onlyTheirs > 0
            ? `you haven't rated ${comparison.onlyTheirs} of theirs`
            : null}
        </div>
      ) : null}
    </div>
  );
}
