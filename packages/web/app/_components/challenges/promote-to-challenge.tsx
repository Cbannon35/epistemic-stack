"use client";

import { FlagIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useRoom } from "@/app/_components/room-provider";
import {
  type ChallengeableNode,
  listChallengeableNodes,
  promoteCommentToChallenge,
} from "@/app/(chat)/challenge-actions";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CHALLENGE_TYPE_LABELS,
  CHALLENGE_TYPES,
  type ChallengeType,
} from "@/lib/challenge-types";
import { invalidateChallengeCounts } from "./challenge-count";

// Promote a public comment thread into a commons challenge: pick the node the
// discussion actually disputes, and the quote + thread become an append-only
// dispute record against it.
//
// The button lives INSIDE the thread popover, but the dialog must not — the
// popover dismisses on outside interaction the moment a portaled dialog takes
// focus, unmounting anything nested in it. So the button only signals the
// module-level host, which owns the dialog from a stable mount point.

const listeners = new Set<(commentId: string) => void>();

function requestPromote(commentId: string) {
  for (const listener of listeners) {
    listener(commentId);
  }
}

export function PromoteToChallenge({
  commentId,
  onDone,
}: {
  commentId: string;
  /** Called first — lets the thread popover close itself cleanly. */
  onDone: () => void;
}) {
  return (
    <button
      className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-[background-color,color] duration-150 hover:bg-muted hover:text-foreground"
      onClick={() => {
        onDone();
        requestPromote(commentId);
      }}
      title="Promote this thread to a commons challenge against a graph node"
      type="button"
    >
      <FlagIcon className="size-3" /> promote
    </button>
  );
}

const KIND_HINT: Record<string, string> = {
  claim: "claim",
  source: "source",
  hypothesis: "hyp",
};

function PromoteDialogBody({
  commentId,
  onClose,
}: {
  commentId: string;
  onClose: () => void;
}) {
  const room = useRoom();
  const { roomId, channel } = room;
  const [nodes, setNodes] = useState<ChallengeableNode[] | null>(null);
  const [target, setTarget] = useState<ChallengeableNode | null>(null);
  const [challengeType, setChallengeType] = useState<ChallengeType>(
    "rival_interpretation"
  );
  const [filing, setFiling] = useState(false);

  useEffect(() => {
    listChallengeableNodes(roomId)
      .then(setNodes)
      .catch(() => setNodes([]));
  }, [roomId]);

  const promote = async () => {
    if (!target || filing) {
      return;
    }
    setFiling(true);
    const result = await promoteCommentToChallenge({
      commentId,
      nodeId: target.id,
      challengeType,
      sessionId: roomId,
    });
    setFiling(false);
    if (!result.ok) {
      return;
    }
    invalidateChallengeCounts();
    channel.send("challenges:changed", {
      nodeId: target.id,
      actorId: room.me.userId,
      actorName: room.me.displayName,
      nodeLabel: target.label,
      action: "challenged",
    });
    onClose();
    // Land the user on the freshly-flagged node.
    graphBus.emit("focusNode", { nodeId: target.id });
  };

  return (
    <>
      <DialogHeader className="px-4 pt-4">
        <DialogTitle className="text-sm">Promote to a challenge</DialogTitle>
        <DialogDescription className="text-xs">
          The thread becomes an append-only dispute record against the node you
          pick — visible to every investigation that touches it.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-1 px-4">
        {CHALLENGE_TYPES.map((type) => (
          <button
            className={`rounded-full border px-2 py-0.5 text-[10px] transition-[background-color,border-color,color] duration-150 ${
              type === challengeType
                ? "border-border bg-muted text-foreground"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
            key={type}
            onClick={() => setChallengeType(type)}
            type="button"
          >
            {CHALLENGE_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      <Command className="rounded-none border-border/40 border-t bg-transparent p-0">
        <CommandInput placeholder="Which node does this dispute?" />
        <CommandList className="max-h-56">
          <CommandEmpty className="p-3 text-muted-foreground text-xs">
            {nodes === null ? "loading the graph…" : "no matching nodes"}
          </CommandEmpty>
          <CommandGroup>
            {(nodes ?? []).map((node) => (
              <CommandItem
                className={`text-xs ${target?.id === node.id ? "bg-muted" : ""}`}
                key={node.id}
                onSelect={() => setTarget(node)}
                value={`${node.label} ${node.id}`}
              >
                <span className="w-9 shrink-0 text-[9px] text-muted-foreground uppercase">
                  {KIND_HINT[node.kind] ?? node.kind}
                </span>
                <span className="line-clamp-2">{node.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
      <div className="flex items-center justify-between border-border/40 border-t px-4 py-3">
        <p className="line-clamp-1 pr-2 text-[10px] text-muted-foreground">
          {target ? target.label : "pick a node above"}
        </p>
        <button
          className="shrink-0 rounded-md bg-foreground px-2 py-1 text-[11px] text-background transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          disabled={!target || filing}
          onClick={promote}
          type="button"
        >
          {filing ? "filing…" : "File challenge"}
        </button>
      </div>
    </>
  );
}

/** Single dialog owner — mount once near the transcript, outside popovers. */
export function PromoteChallengeHost() {
  const [commentId, setCommentId] = useState<string | null>(null);

  useEffect(() => {
    const listener = (id: string) => setCommentId(id);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setCommentId(null);
        }
      }}
      open={commentId !== null}
    >
      <DialogContent className="max-w-md p-0">
        {commentId ? (
          <PromoteDialogBody
            commentId={commentId}
            key={commentId}
            onClose={() => setCommentId(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
