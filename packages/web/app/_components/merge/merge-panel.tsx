"use client";

import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  GitMergeIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import type { GraphEdge, GraphNode } from "@/app/_components/graph/types";
import {
  decideMergeRequestAction,
  withdrawMergeRequestAction,
} from "@/app/(chat)/merge-actions";
import type { MergeDiffCounts, MergeRequestRecord } from "@/lib/merge-types";

// Review surface for merge requests: what a fork proposes to bring into this
// room's scope. The diff is pure addition (append-only graphs have no
// "modified") — incoming nodes list here and can be previewed in place on
// the live graph before the owner accepts.

type Provenance = {
  contributorName: string;
  contributorKind: string;
  method: string;
  createdAt: string;
};

type Diff = {
  incoming: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    provenance: Record<string, Provenance>;
  };
  counts: MergeDiffCounts;
};

const KIND_ORDER: GraphNode["kind"][] = [
  "hypothesis",
  "claim",
  "crux",
  "source",
];

const STATUS_TONE: Record<string, string> = {
  open: "text-amber-600 dark:text-amber-400",
  accepted: "text-emerald-600 dark:text-emerald-400",
  declined: "text-muted-foreground",
  withdrawn: "text-muted-foreground",
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) {
    return "now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function IncomingNodeRow({
  node,
  provenance,
}: {
  node: GraphNode;
  provenance: Provenance | undefined;
}) {
  return (
    <button
      className="block w-full rounded px-1.5 py-1 text-left transition-colors duration-150 hover:bg-muted/60"
      onClick={() => graphBus.emit("focusNode", { nodeId: node.id })}
      type="button"
    >
      <span className="block truncate text-foreground text-xs">
        <span className="mr-1.5 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground uppercase">
          {node.kind}
        </span>
        {node.label}
      </span>
      {provenance ? (
        <span className="block truncate text-[10px] text-muted-foreground">
          recorded by {provenance.contributorName} · {provenance.method}
        </span>
      ) : null}
    </button>
  );
}

function DiffBody({ diff }: { diff: Diff }) {
  if (diff.counts.incoming === 0) {
    return (
      <p className="px-1.5 py-1 text-muted-foreground text-xs">
        Nothing new to adopt — the fork hasn't diverged from this room (or its
        additions already merged).
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="px-1.5 text-[10px] text-muted-foreground">
        +{diff.counts.incoming} nodes · {diff.incoming.edges.length} edges ·{" "}
        {diff.counts.shared} already shared
      </p>
      {KIND_ORDER.map((kind) => {
        const nodes = diff.incoming.nodes.filter((n) => n.kind === kind);
        if (nodes.length === 0) {
          return null;
        }
        return (
          <div key={kind}>
            {nodes.map((n) => (
              <IncomingNodeRow
                key={n.id}
                node={n}
                provenance={diff.incoming.provenance[n.id]}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MergeRequestCard({
  mr,
  investigation,
  isOwner,
  meId,
  previewMrId,
  onPreview,
  onChanged,
}: {
  mr: MergeRequestRecord;
  investigation: string;
  isOwner: boolean;
  meId: string;
  previewMrId: string | null;
  onPreview: (preview: { mrId: string; ids: string[] } | null) => void;
  onChanged: () => void;
}) {
  const incoming = mr.targetId === investigation;
  const [diff, setDiff] = useState<Diff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewing = previewMrId === mr.id;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/merge/diff?mr=${encodeURIComponent(mr.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Diff | null) => {
        if (!cancelled && d) {
          setDiff(d);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mr.id]);

  const act = useCallback(
    (run: () => Promise<{ ok?: true; error?: string }>) => {
      setBusy(true);
      setError(null);
      run()
        .then((res) => {
          if (res.error) {
            setError(res.error);
          } else {
            onPreview(null);
            onChanged();
          }
        })
        .finally(() => setBusy(false));
    },
    [onChanged, onPreview]
  );

  const direction = incoming
    ? `from “${mr.sourceTitle ?? "a fork"}”`
    : `into “${mr.targetTitle ?? "its parent"}”`;

  return (
    <div className="space-y-2 rounded-lg border border-border/50 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-foreground text-xs">
            <GitMergeIcon className="mr-1 inline size-3" />
            {incoming ? "Incoming merge" : "Proposed merge"} {direction}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {mr.proposerName} · {timeAgo(mr.createdAt)} ·{" "}
            <span className={STATUS_TONE[mr.status]}>{mr.status}</span>
          </p>
        </div>
      </div>
      {mr.note ? (
        <p className="rounded bg-muted/50 px-2 py-1 text-muted-foreground text-xs">
          {mr.note}
        </p>
      ) : null}
      {mr.status !== "open" && mr.decisionNote ? (
        <p className="text-[10px] text-muted-foreground">
          {mr.reviewerName ?? "reviewer"}: {mr.decisionNote}
        </p>
      ) : null}
      {mr.status === "open" && diff ? <DiffBody diff={diff} /> : null}
      {mr.status === "open" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {incoming && diff && diff.counts.incoming > 0 ? (
            <button
              className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
              onClick={() =>
                onPreview(
                  previewing
                    ? null
                    : {
                        mrId: mr.id,
                        ids: [
                          ...diff.incoming.nodes.map((n) => n.id),
                          ...diff.incoming.edges.map((e) => e.id),
                        ],
                      }
                )
              }
              type="button"
            >
              {previewing ? (
                <EyeOffIcon className="size-3" />
              ) : (
                <EyeIcon className="size-3" />
              )}
              {previewing ? "End preview" : "Preview in graph"}
            </button>
          ) : null}
          {incoming && isOwner ? (
            <>
              <button
                className="flex items-center gap-1 rounded-md border border-emerald-600/40 px-2 py-1 text-emerald-600 text-xs transition-colors duration-150 hover:bg-emerald-600/10 dark:text-emerald-400"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    decideMergeRequestAction({
                      mrId: mr.id,
                      decision: "accepted",
                    })
                  )
                }
                type="button"
              >
                <CheckIcon className="size-3" /> Accept merge
              </button>
              <button
                className="rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    decideMergeRequestAction({
                      mrId: mr.id,
                      decision: "declined",
                    })
                  )
                }
                type="button"
              >
                Decline
              </button>
            </>
          ) : null}
          {incoming && !isOwner ? (
            <span className="text-[10px] text-muted-foreground">
              the room's owner reviews this
            </span>
          ) : null}
          {mr.proposerId === meId ? (
            <button
              className="rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
              disabled={busy}
              onClick={() =>
                act(() => withdrawMergeRequestAction({ mrId: mr.id }))
              }
              type="button"
            >
              Withdraw
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

export function MergePanel({
  investigation,
  mergeRequests,
  isOwner,
  meId,
  previewMrId,
  onPreview,
  onChanged,
  onClose,
}: {
  investigation: string;
  mergeRequests: MergeRequestRecord[];
  isOwner: boolean;
  meId: string;
  previewMrId: string | null;
  onPreview: (preview: { mrId: string; ids: string[] } | null) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const open = mergeRequests.filter((m) => m.status === "open");
  const decided = mergeRequests.filter((m) => m.status !== "open");
  return (
    <div className="panel-in-right absolute top-0 right-0 bottom-0 z-20 flex w-[26rem] max-w-[90%] flex-col border-border/60 border-l bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between border-border/40 border-b px-4 py-3">
        <div>
          <p className="font-medium text-sm">Merges</p>
          <p className="text-[11px] text-muted-foreground">
            Scope adoption, not copying — accepting widens what this room's
            lineage sees.
          </p>
        </div>
        <button
          aria-label="Close merges"
          className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {mergeRequests.length === 0 ? (
          <p className="px-1 text-muted-foreground text-xs">
            No merge requests yet. Fork rooms propose merges back to their
            lineage from the graph toolbar.
          </p>
        ) : null}
        {open.map((mr) => (
          <MergeRequestCard
            investigation={investigation}
            isOwner={isOwner}
            key={mr.id}
            meId={meId}
            mr={mr}
            onChanged={onChanged}
            onPreview={onPreview}
            previewMrId={previewMrId}
          />
        ))}
        {decided.length > 0 ? (
          <p className="px-1 pt-1 text-[10px] text-muted-foreground uppercase">
            history
          </p>
        ) : null}
        {decided.map((mr) => (
          <MergeRequestCard
            investigation={investigation}
            isOwner={isOwner}
            key={mr.id}
            meId={meId}
            mr={mr}
            onChanged={onChanged}
            onPreview={onPreview}
            previewMrId={previewMrId}
          />
        ))}
      </div>
    </div>
  );
}
