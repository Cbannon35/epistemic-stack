// Tiny module-singleton event bus bridging the chat (tool cards) and the
// graph panel (focus/center a node) without threading props through the tree.

type GraphBusEvents = {
  focusNode: { nodeId: string };
  /** Emitted by the graph panel when a same-scope reload grew the graph —
   * positive per-kind deltas only. Feeds the awareness ticker. */
  graphDelta: {
    claims: number;
    sources: number;
    relations: number;
    cruxes: number;
    hypotheses: number;
  };
  /** Reveal the graph pane and open the investigations dock composer. */
  openDelegate: Record<string, never>;
  /** Fullscreen the graph in whole-commons scope with the search bar open. */
  openCommonsSearch: Record<string, never>;
  /** Escape the first-glance detail budget — tours/delegations walk nodes
   * the model chose from the FULL catalog, which may be tier-hidden. */
  revealNode: { nodeId: string };
};

type AnyHandler = (payload: never) => void;

const listeners = new Map<keyof GraphBusEvents, Set<AnyHandler>>();

export const graphBus = {
  on<E extends keyof GraphBusEvents>(
    event: E,
    handler: (payload: GraphBusEvents[E]) => void
  ): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      set.delete(handler as AnyHandler);
    };
  },
  emit<E extends keyof GraphBusEvents>(
    event: E,
    payload: GraphBusEvents[E]
  ): void {
    for (const handler of listeners.get(event) ?? []) {
      (handler as (p: GraphBusEvents[E]) => void)(payload);
    }
  },
};
