import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import type { GraphData } from "@/app/_components/graph/types";

// Deterministic force layout, shared by the room graph panel and the public
// topic preview. Constants here are load-bearing: cursors and tours broadcast
// flow coordinates, so every client must compute identical positions.

export function layout(
  data: Pick<GraphData, "nodes" | "edges">
): Map<string, { x: number; y: number }> {
  // Sort by id first: d3-force is deterministic (seeded LCG + index-based
  // initial placement) only for identical input ORDER, and Postgres row order
  // isn't guaranteed. With the sort, every client computes identical positions
  // for the same graph — which is what lets live cursors and the eve tour
  // broadcast flow coordinates.
  const sortedNodes = data.nodes.toSorted((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = data.edges.toSorted((a, b) => a.id.localeCompare(b.id));
  const sim = sortedNodes.map((n) => ({ id: n.id, kind: n.kind })) as Array<{
    id: string;
    kind: string;
    x?: number;
    y?: number;
  }>;
  const links = sortedEdges.map((e) => ({
    source: e.source,
    target: e.target,
  }));
  const simulation = forceSimulation(sim)
    // Hypotheses repel harder so their clusters spread out. Pill nodes are
    // wide, text-bearing shapes — spacing tuned so labels don't overlap.
    .force(
      "charge",
      forceManyBody().strength((d) =>
        (d as { kind: string }).kind === "hypothesis" ? -1600 : -700
      )
    )
    .force(
      "link",
      forceLink(links as any)
        .id((d: any) => d.id)
        .distance(175)
    )
    .force("center", forceCenter(0, 0))
    // A weak pull toward the origin keeps disconnected components (e.g. a
    // hypothesis with no recorded links yet) from drifting to the horizon
    // and forcing the camera to zoom way out.
    .force("x", forceX(0).strength(0.06))
    .force("y", forceY(0).strength(0.06))
    .force("collide", forceCollide(115))
    .stop();
  for (let i = 0; i < 320; i++) {
    simulation.tick();
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of sim) {
    pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  }
  return pos;
}
