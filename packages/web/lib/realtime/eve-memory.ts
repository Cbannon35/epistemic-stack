// Room-wide eve memory: a small shared ring of recent @eve exchanges and
// delegation summaries, so one member's question builds on another's. Whoever
// completes an exchange pushes locally AND broadcasts an "eve-memory" room
// event; every present client accumulates the same ring. Deliberately
// session-lifetime (no persistence): late joiners start from now — the memory
// only tunes eve's context, so the degradation is graceful.

const MAX_ENTRIES = 8;

type MemoryEntry = { entry: string; ts: number };

const rings = new Map<string, MemoryEntry[]>();

export function pushEveMemory(roomId: string, entry: string, ts: number): void {
  const ring = rings.get(roomId) ?? [];
  // Broadcasts echo back through multiple hooks — same (ts, entry) is a dupe.
  if (ring.some((e) => e.ts === ts && e.entry === entry)) {
    return;
  }
  ring.push({ entry, ts });
  ring.sort((a, b) => a.ts - b.ts);
  rings.set(roomId, ring.slice(-MAX_ENTRIES));
}

/** Oldest→newest entries for the room, ready to join into eve's context. */
export function eveMemorySnapshot(roomId: string): string[] {
  return (rings.get(roomId) ?? []).map((e) => e.entry);
}
