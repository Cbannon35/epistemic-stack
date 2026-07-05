"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRoom } from "@/app/_components/room-provider";
import { getChallengeCounts } from "@/app/(chat)/challenge-actions";
import type { NodeChallengeSummary } from "@/lib/challenge-types";
import { CONTESTED_COLOR } from "./challenge-flag";

// Dispute rollups for chat claim cards. A transcript can hold many cards, so
// a module singleton batches their node ids into one server-action call per
// debounce window and fans results back out through useSyncExternalStore.

const known = new Map<string, NodeChallengeSummary | null>();
const wanted = new Set<string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function schedule() {
  if (!timer) {
    timer = setTimeout(flush, 250);
  }
}

async function flush() {
  timer = null;
  const ids = [...pending];
  if (ids.length === 0) {
    return;
  }
  const result = await getChallengeCounts(ids).catch(
    () => ({}) as Record<string, NodeChallengeSummary>
  );
  for (const id of ids) {
    known.set(id, result[id] ?? null);
    pending.delete(id);
  }
  notify();
}

function register(nodeId: string) {
  wanted.add(nodeId);
  if (!(known.has(nodeId) || pending.has(nodeId))) {
    pending.add(nodeId);
    schedule();
  }
}

/** Drop the cache and refetch every registered node (a dispute changed). */
export function invalidateChallengeCounts() {
  known.clear();
  for (const id of wanted) {
    pending.add(id);
  }
  schedule();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Tiny dispute chip for a chat claim card: red while contested, quiet once
// answered, absent when the claim is undisputed (or the id is unknown yet).
export function ChallengeCountBadge({ nodeId }: { nodeId: string | null }) {
  const { channel } = useRoom();
  const { on } = channel;
  const summary = useSyncExternalStore(
    subscribe,
    () => (nodeId ? known.get(nodeId) : undefined),
    () => undefined
  );

  useEffect(() => {
    if (nodeId) {
      register(nodeId);
    }
  }, [nodeId]);

  useEffect(
    () => on("challenges:changed", () => invalidateChallengeCounts()),
    [on]
  );

  if (!(nodeId && summary)) {
    return null;
  }
  const contested = summary.state === "contested";
  return (
    <span
      className="rounded-full border px-1.5 py-0.5 text-[10px]"
      style={
        contested
          ? {
              borderColor: CONTESTED_COLOR,
              color: CONTESTED_COLOR,
              fontWeight: 500,
            }
          : {
              borderColor: "var(--border)",
              color: "var(--muted-foreground)",
            }
      }
      title={
        contested
          ? `${summary.open} open challenge${summary.open === 1 ? "" : "s"} — see the graph node for the dispute`
          : `challenged · all ${summary.total} answered`
      }
    >
      ⚑ {contested ? `${summary.open} challenged` : "answered"}
    </span>
  );
}
