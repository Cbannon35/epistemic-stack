"use client";

import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Edge, Node } from "@xyflow/react";
import { useMemo } from "react";
import { CONTESTED_COLOR } from "@/app/_components/challenges/challenge-flag";
import { layout } from "@/app/_components/graph/layout";
import { nodeTypes } from "@/app/_components/graph/nodes";
import {
  EDGE_STYLE,
  type GraphEdge,
  type GraphNode,
} from "@/app/_components/graph/types";

// Read-only render of a topic slice for the public gallery: the same pill
// nodes, edge styles, and deterministic layout as the app's graph, with none
// of the room machinery (presence, cursors, inspector, bus). Slices are
// capped server-side, so everything the payload carries is drawn.

function toFlow(nodes: GraphNode[], edges: GraphEdge[]) {
  const positions = layout({ nodes, edges });
  const rfNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    draggable: false,
    connectable: false,
    data: {
      label: n.label,
      sources: n.sources,
      position: n.position,
      challenges: n.challenges,
      detail: n.detail,
      study: Boolean(n.detail?.peer_reviewed),
    },
  }));
  const rfEdges: Edge[] = edges.map((e) => {
    const s = EDGE_STYLE[e.kind] ?? EDGE_STYLE.mention;
    const width = e.diagnosticity
      ? 1 + e.diagnosticity * 2.5
      : e.kind === "mention"
        ? 1
        : 1.6;
    const contested = e.challenges?.state === "contested";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      style: { stroke: s.stroke, strokeWidth: width, strokeDasharray: s.dash },
      ...(e.challenges
        ? {
            label: `⚑ ${contested ? e.challenges.open : e.challenges.total}`,
            labelStyle: {
              fill: contested ? "#fff" : "var(--muted-foreground)",
              fontSize: 8,
              fontWeight: 700,
            },
            labelBgStyle: {
              fill: contested ? CONTESTED_COLOR : "var(--muted)",
              fillOpacity: 1,
            },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 6,
          }
        : {}),
    };
  });
  return { rfNodes, rfEdges };
}

export function TopicGraphPreview({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const { rfNodes, rfEdges } = useMemo(
    () => toFlow(nodes, edges),
    [nodes, edges]
  );
  return (
    <div className="h-[420px] overflow-hidden rounded-xl border border-border/60 bg-background">
      <ReactFlow
        edges={rfEdges}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        maxZoom={1.4}
        minZoom={0.1}
        nodes={rfNodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodeTypes={nodeTypes}
        panOnScroll
        preventScrolling={false}
      >
        <Background gap={24} size={1} />
      </ReactFlow>
    </div>
  );
}
