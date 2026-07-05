"use client";

import { useSyncExternalStore } from "react";

// Module store for the people layer, bridging surfaces that don't share a
// tree: person cards (chat header / graph toolbar), the follow camera (inside
// ReactFlow), the workspace pane, and the graph panel (which owns lens state).
// Same singleton pattern as graph-bus, plus a snapshot for useSyncExternalStore.

export type FollowTarget = { userId: string; displayName: string };
export type CompareTarget = { contributorId: string; displayName: string };

export type PeopleState = {
  /** Person whose viewport this client is shadowing. */
  follow: FollowTarget | null;
  /** Person whose credences are being compared against mine. */
  compare: CompareTarget | null;
};

let state: PeopleState = { follow: null, compare: null };
const subscribers = new Set<() => void>();
const adoptHandlers = new Set<(lensId: string) => void>();

function commit(next: Partial<PeopleState>): void {
  state = { ...state, ...next };
  for (const notify of subscribers) {
    notify();
  }
}

export const peopleBus = {
  getState: (): PeopleState => state,
  subscribe(notify: () => void): () => void {
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  },
  setFollow(target: FollowTarget | null): void {
    commit({ follow: target });
  },
  setCompare(target: CompareTarget | null): void {
    commit({ compare: target });
  },
  /** Handled by the graph panel, which owns the active-lens state. */
  onAdoptLens(handler: (lensId: string) => void): () => void {
    adoptHandlers.add(handler);
    return () => {
      adoptHandlers.delete(handler);
    };
  },
  adoptLens(lensId: string): void {
    for (const handler of adoptHandlers) {
      handler(lensId);
    }
  },
};

export function usePeopleState(): PeopleState {
  return useSyncExternalStore(
    peopleBus.subscribe,
    peopleBus.getState,
    peopleBus.getState
  );
}
