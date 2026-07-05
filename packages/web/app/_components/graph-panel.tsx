"use client";

import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import { PanelRightCloseIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssessmentPanel } from "@/app/_components/graph/assessment-panel";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { Inspector } from "@/app/_components/graph/inspector";
import { nodeTypes } from "@/app/_components/graph/nodes";
import { GraphTimeSlider } from "@/app/_components/graph/time-slider";
import { EDGE_STYLE, type GraphData } from "@/app/_components/graph/types";
import { CursorLayer } from "@/app/_components/presence/cursor-layer";
import { PresenceAvatars } from "@/app/_components/presence/presence-avatars";
import { useRoom } from "@/app/_components/room-provider";
import { createClient } from "@/lib/supabase/client";

function layout(data: GraphData): Map<string, { x: number; y: number }> {
  // Sort by id first: d3-force is deterministic (seeded LCG + index-based
  // initial placement) only for identical input ORDER, and Postgres row order
  // isn't guaranteed. With the sort, every client computes identical positions
  // for the same graph — which is what lets live cursors and the eve tour
  // broadcast flow coordinates.
  const sortedNodes = [...data.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...data.edges].sort((a, b) => a.id.localeCompare(b.id));
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
    // Hypotheses repel harder so their clusters spread out.
    .force(
      "charge",
      forceManyBody().strength((d) =>
        (d as { kind: string }).kind === "hypothesis" ? -1400 : -520
      )
    )
    .force(
      "link",
      forceLink(links as any)
        .id((d: any) => d.id)
        .distance(115)
    )
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(74))
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

const pillClass =
  "rounded-full border px-2 py-0.5 text-[10px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] active:bg-muted";

const iconButtonClass =
  "rounded-md p-1 text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-95 active:bg-muted active:text-foreground";

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`${pillClass} ${
        active
          ? "border-border bg-muted text-foreground"
          : "border-border/50 text-muted-foreground line-through hover:text-foreground"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

const LEGEND: Array<{ color: string; label: string; dash?: boolean }> = [
  { color: "#7c3aed", label: "hypothesis" },
  { color: "#16a34a", label: "supports" },
  { color: "#dc2626", label: "contradicts" },
  { color: "#6b7280", label: "depends on", dash: true },
  { color: "#d97706", label: "crux" },
  { color: "#cbd5e1", label: "cites source" },
];

export function GraphPanel({ onClose }: { onClose?: () => void }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [positions, setPositions] = useState<
    Map<string, { x: number; y: number }>
  >(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(true);
  const [showCruxes, setShowCruxes] = useState(true);
  const [showAssessment, setShowAssessment] = useState(false);
  const [commonsMode, setCommonsMode] = useState(false);
  // Replay: hide everything contributed after this moment (null = live).
  const [timeCap, setTimeCap] = useState<number | null>(null);

  const sigRef = useRef("");
  const room = useRoom();
  const investigation = room.roomId;
  const invRef = useRef<string | null>(investigation);
  invRef.current = investigation;
  const commonsRef = useRef(commonsMode);
  commonsRef.current = commonsMode;
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const dataRef = useRef<GraphData | null>(null);
  dataRef.current = data;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // Chat tool cards focus their graph node through the bus: reveal the kind's
  // filter if hidden, select, and glide the camera over.
  useEffect(
    () =>
      graphBus.on("focusNode", ({ nodeId }) => {
        const node = dataRef.current?.nodes.find((n) => n.id === nodeId);
        if (!node) {
          return;
        }
        if (node.kind === "source") {
          setShowSources(true);
        }
        if (node.kind === "crux") {
          setShowCruxes(true);
        }
        setSelectedId(nodeId);
        // Wait a frame so a just-unfiltered node exists before centering.
        requestAnimationFrame(() => {
          const rf = rfRef.current;
          if (!rf) {
            return;
          }
          const rfNode = rf.getNode(nodeId);
          const pos = rfNode
            ? {
                x: rfNode.position.x + (rfNode.measured?.width ?? 200) / 2,
                y: rfNode.position.y + (rfNode.measured?.height ?? 60) / 2,
              }
            : positionsRef.current.get(nodeId);
          if (pos) {
            rf.setCenter(pos.x, pos.y, {
              duration: 400,
              zoom: Math.max(rf.getZoom(), 0.9),
            });
          }
        });
      }),
    []
  );

  const load = useCallback(async (force = false) => {
    const commons = commonsRef.current;
    const inv = invRef.current;
    if (!(commons || inv)) {
      if (!force && sigRef.current === "empty") {
        return;
      }
      sigRef.current = "empty";
      setData({
        nodes: [],
        edges: [],
        counts: {
          claims: 0,
          sources: 0,
          relations: 0,
          cruxes: 0,
          hypotheses: 0,
        },
      });
      setPositions(new Map());
      return;
    }
    const url = commons
      ? "/api/graph"
      : `/api/graph?investigation=${encodeURIComponent(inv as string)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return;
    }
    const d: GraphData = await res.json();
    // Credence count rides the signature: belief-only changes add no nodes or
    // edges but must still repaint (node bars, inspector, assessment panel).
    const sig = `${commons ? "commons" : inv}:${d.nodes.length}:${d.edges.length}:${d.counts.credences ?? 0}`;
    if (!force && sig === sigRef.current) {
      return;
    }
    sigRef.current = sig;
    setData(d);
    setPositions(layout(d));
  }, []);

  // Reload when the scope (investigation / commons) changes, plus a slow fallback poll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load reads the scope via refs; the effect must re-run when it changes
  useEffect(() => {
    load(true);
    const t = setInterval(() => load(), 8000);
    return () => clearInterval(t);
  }, [load, investigation, commonsMode]);

  // Live updates: any write inserts a contribution; reload (debounced) on change.
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("commons-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "contributions" },
        () => {
          if (timer) {
            return;
          }
          timer = setTimeout(() => {
            timer = null;
            load();
          }, 700);
        }
      )
      .subscribe();
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Resolve source ids → label/url for the inspector.
  const sourceById = useMemo(() => {
    const m = new Map<string, { label: string; url?: string | null }>();
    for (const n of data?.nodes ?? []) {
      if (n.kind === "source") {
        m.set(n.id, { label: n.label, url: (n.detail?.url as string) ?? null });
      }
    }
    return m;
  }, [data]);

  // Derive React Flow nodes/edges from data + positions + filters + selection.
  const { rfNodes, rfEdges } = useMemo(() => {
    if (!data) {
      return { rfNodes: [] as Node[], rfEdges: [] as Edge[] };
    }
    const hidden = new Set<string>();
    for (const n of data.nodes) {
      if (
        (n.kind === "source" && !showSources) ||
        (n.kind === "crux" && !showCruxes) ||
        (timeCap != null && typeof n.t === "number" && n.t > timeCap)
      ) {
        hidden.add(n.id);
      }
    }
    const rfNodes: Node[] = data.nodes
      .filter((n) => !hidden.has(n.id))
      .map((n) => ({
        id: n.id,
        type: n.kind,
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        selected: n.id === selectedId,
        data: {
          label: n.label,
          sources: n.sources,
          position: n.position,
          detail: n.detail,
        },
      }));
    const rfEdges: Edge[] = data.edges
      .filter(
        (e) =>
          !(
            hidden.has(e.source) ||
            hidden.has(e.target) ||
            (timeCap != null && typeof e.t === "number" && e.t > timeCap)
          )
      )
      .map((e) => {
        const s = EDGE_STYLE[e.kind] ?? EDGE_STYLE.mention;
        const width = e.diagnosticity
          ? 1 + e.diagnosticity * 2.5
          : e.kind === "mention"
            ? 1
            : 1.6;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          style: {
            stroke: s.stroke,
            strokeWidth: width,
            strokeDasharray: s.dash,
          },
          animated: e.kind === "supports" || e.kind === "contradicts",
        };
      });
    return { rfNodes, rfEdges };
  }, [data, positions, selectedId, showSources, showCruxes, timeCap]);

  const selectedNode = data?.nodes.find((n) => n.id === selectedId) ?? null;
  const counts = data?.counts;

  // Replay bounds: the span of contribution timestamps in the loaded graph.
  const timeBounds = useMemo(() => {
    const ts: number[] = [];
    for (const n of data?.nodes ?? []) {
      if (typeof n.t === "number") {
        ts.push(n.t);
      }
    }
    if (ts.length < 2) {
      return null;
    }
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    return max > min ? { min, max } : null;
  }, [data]);

  return (
    <div className="relative h-full w-full bg-background">
      <div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between gap-2 border-border/40 border-b bg-background/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            className={`${pillClass} border-border font-medium hover:bg-muted`}
            onClick={() => setCommonsMode((v) => !v)}
            title="Switch between this investigation and the whole shared commons"
            type="button"
          >
            {commonsMode ? "◈ whole commons" : "◇ this investigation"}
          </button>
          <FilterButton
            active={showSources}
            onClick={() => setShowSources((v) => !v)}
          >
            sources
          </FilterButton>
          <FilterButton
            active={showCruxes}
            onClick={() => setShowCruxes((v) => !v)}
          >
            cruxes
          </FilterButton>
          <button
            className={`${pillClass} border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground`}
            onClick={() => setShowAssessment((v) => !v)}
            type="button"
          >
            ⚖ assessment
          </button>
          {timeBounds ? (
            <button
              className={`${pillClass} ${
                timeCap == null
                  ? "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  : "border-border bg-muted text-foreground"
              }`}
              onClick={() =>
                setTimeCap((cap) => (cap == null ? timeBounds.max : null))
              }
              title="Replay how the graph was built, contribution by contribution"
              type="button"
            >
              ↺ replay
            </button>
          ) : null}
        </div>
        <span className="flex items-center gap-3 text-muted-foreground text-xs">
          <PresenceAvatars view="graph" />
          {counts ? (
            <span className="hidden sm:inline">
              {counts.hypotheses} hyp · {counts.claims} claims ·{" "}
              {counts.relations} links · {counts.cruxes} cruxes ·{" "}
              {counts.sources} sources
            </span>
          ) : null}
          <button
            aria-label="Refresh"
            className={iconButtonClass}
            onClick={() => load(true)}
            title="Refresh"
            type="button"
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
          {onClose ? (
            <button
              aria-label="Hide graph"
              className={iconButtonClass}
              onClick={onClose}
              title="Hide graph"
              type="button"
            >
              <PanelRightCloseIcon className="size-3.5" />
            </button>
          ) : null}
        </span>
      </div>

      {rfNodes.length === 0 ? (
        <div className="fade-in pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-muted-foreground text-sm">
          Ask a question — the argument map builds here.
        </div>
      ) : null}

      <ReactFlow
        edges={rfEdges}
        fitView
        minZoom={0.1}
        nodes={rfNodes}
        nodesDraggable={false}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          rfRef.current = instance;
        }}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <CursorLayer />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-md border border-border/50 bg-background/85 p-2 backdrop-blur">
        {LEGEND.map((l) => (
          <div
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
            key={l.label}
          >
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{
                background: l.dash
                  ? `repeating-linear-gradient(90deg, ${l.color} 0 3px, transparent 3px 6px)`
                  : l.color,
              }}
            />
            {l.label}
          </div>
        ))}
      </div>

      {timeCap != null && timeBounds ? (
        <GraphTimeSlider
          max={timeBounds.max}
          min={timeBounds.min}
          onChange={setTimeCap}
          onClose={() => setTimeCap(null)}
          value={timeCap}
        />
      ) : null}

      {showAssessment && data?.assessment ? (
        <AssessmentPanel
          assessment={data.assessment}
          onClose={() => setShowAssessment(false)}
        />
      ) : null}

      {selectedNode ? (
        <Inspector
          node={selectedNode}
          onClose={() => setSelectedId(null)}
          sourceById={sourceById}
        />
      ) : null}
    </div>
  );
}
