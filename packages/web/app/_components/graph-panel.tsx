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
  ListTreeIcon,
  Maximize2Icon,
  PanelRightCloseIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTESTED_COLOR } from "@/app/_components/challenges/challenge-flag";
import { AssessmentPanel } from "@/app/_components/graph/assessment-panel";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { GraphSearchBar } from "@/app/_components/graph/graph-search";
import { Inspector } from "@/app/_components/graph/inspector";
import { layout } from "@/app/_components/graph/layout";
import { nodeTypes } from "@/app/_components/graph/nodes";
import { OverviewPanel } from "@/app/_components/graph/overview-panel";
import { SourcePreview } from "@/app/_components/graph/source-preview";
import { SourceRail } from "@/app/_components/graph/source-rail";
import { GraphTimeSlider } from "@/app/_components/graph/time-slider";
import {
  EDGE_STYLE,
  type GraphData,
  type GraphNode,
  type InspectorSubject,
} from "@/app/_components/graph/types";
import { JournalPanel } from "@/app/_components/journal/journal-panel";
import { CompareBeliefsPanel } from "@/app/_components/people/compare-beliefs-panel";
import { peopleBus, usePeopleState } from "@/app/_components/people/people-bus";
import { CursorLayer } from "@/app/_components/presence/cursor-layer";
import { PresenceAvatars } from "@/app/_components/presence/presence-avatars";
import { useRoom } from "@/app/_components/room-provider";
import { createClient } from "@/lib/supabase/client";

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
  { color: "#16a34a", label: "supports" },
  { color: "#dc2626", label: "contradicts" },
  { color: "#6b7280", label: "depends on", dash: true },
  { color: "#d97706", label: "crux" },
  { color: "#cbd5e1", label: "cites source" },
];

// First-glance detail budget: how many claims each "Expand to see more"
// press reveals. Everything beyond the last step means "show all".
const CLAIM_BUDGETS = [6, 18, 54];

export function GraphPanel({
  onClose,
  full = false,
  onToggleFull,
}: {
  onClose?: () => void;
  /** Fullscreen "Exploration Breakdown" mode — the graph took over the chat. */
  full?: boolean;
  onToggleFull?: () => void;
}) {
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
  // Progressive disclosure: start with the most-connected claims only, and
  // let the user "Expand to see more". Focusing a hidden node reveals it.
  const [detailLevel, setDetailLevel] = useState(0);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showOverview, setShowOverview] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  // A source opened in the in-page preview (rail card click).
  const [previewSource, setPreviewSource] = useState<GraphNode | null>(null);

  const sigRef = useRef("");
  // Last counts per scope — same-scope growth is narrated on the ticker.
  const prevCountsRef = useRef<{
    scope: string;
    counts: GraphData["counts"];
  } | null>(null);
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
        // Focused nodes escape the first-glance detail budget.
        setRevealed((prev) =>
          prev.has(nodeId) ? prev : new Set(prev).add(nodeId)
        );
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
    // Credence and challenge counts ride the signature: belief-only or
    // dispute-only changes add no nodes or edges but must still repaint
    // (node bars, dispute badges, inspector, assessment panel).
    const sig = `${commons ? "commons" : inv}:${d.nodes.length}:${d.edges.length}:${d.counts.credences ?? 0}:${d.counts.challenges ?? 0}`;
    if (!force && sig === sigRef.current) {
      return;
    }
    sigRef.current = sig;
    // Same-scope growth → awareness ticker ("+2 claims · +1 source"). Scope
    // switches (fork ↔ commons) reset the baseline instead of narrating.
    const scope = commons ? "commons" : (inv as string);
    const prev = prevCountsRef.current;
    if (prev && prev.scope === scope) {
      const delta = {
        claims: Math.max(0, d.counts.claims - prev.counts.claims),
        sources: Math.max(0, d.counts.sources - prev.counts.sources),
        relations: Math.max(0, d.counts.relations - prev.counts.relations),
        cruxes: Math.max(0, d.counts.cruxes - prev.counts.cruxes),
        hypotheses: Math.max(0, d.counts.hypotheses - prev.counts.hypotheses),
      };
      if (Object.values(delta).some((n) => n > 0)) {
        graphBus.emit("graphDelta", delta);
      }
    }
    prevCountsRef.current = { scope, counts: d.counts };
    setData(d);
    setPositions(layout(d));
  }, []);

  // Reload when the scope (investigation / commons) changes, plus a slow fallback poll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load reads the scope via refs; the effect must re-run when it changes
  useEffect(() => {
    // A new scope starts back at the first-glance detail level.
    setDetailLevel(0);
    setRevealed(new Set());
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

  // People layer: "Compare beliefs" opens the credence-gap panel here.
  const { compare } = usePeopleState();

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

  // Importance order for the first-glance view: claims ranked by how much
  // argument hangs off them (relations weigh double; disputes bump further).
  // Deterministic (id tie-break) so every client agrees on the ordering.
  const claimRank = useMemo(() => {
    const rank = new Map<string, number>();
    if (!data) {
      return rank;
    }
    const degree = new Map<string, number>();
    const bump = (id: string, w: number) =>
      degree.set(id, (degree.get(id) ?? 0) + w);
    for (const e of data.edges) {
      const w = e.kind === "mention" ? 0.5 : 2;
      bump(e.source, w);
      bump(e.target, w);
    }
    for (const n of data.nodes) {
      if (n.kind === "claim" && n.challenges) {
        bump(n.id, 3);
      }
    }
    const claims = data.nodes
      .filter((n) => n.kind === "claim")
      .sort(
        (a, b) =>
          (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
          a.id.localeCompare(b.id)
      );
    for (const [i, c] of claims.entries()) {
      rank.set(c.id, i);
    }
    return rank;
  }, [data]);

  // Derive React Flow nodes/edges from data + positions + filters + selection.
  const { rfNodes, rfEdges, moreCount } = useMemo(() => {
    if (!data) {
      return { rfNodes: [] as Node[], rfEdges: [] as Edge[], moreCount: 0 };
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
    // First-glance budget (the design's "don't overwhelm on first glance"):
    // hypotheses and cruxes always show; claims beyond the detail level hide
    // unless focused; evidence ghosts ride their claims, capped 2 per claim
    // at level 0. Layout still computes on the FULL set, so positions stay
    // identical across clients (cursors/tours depend on that).
    const claimBudget =
      detailLevel < CLAIM_BUDGETS.length
        ? CLAIM_BUDGETS[detailLevel]
        : Number.POSITIVE_INFINITY;
    const tierHidden = new Set<string>();
    for (const n of data.nodes) {
      if (
        n.kind === "claim" &&
        (claimRank.get(n.id) ?? 0) >= claimBudget &&
        !revealed.has(n.id) &&
        n.id !== selectedId
      ) {
        tierHidden.add(n.id);
      }
    }
    const kindOf = new Map(data.nodes.map((n) => [n.id, n.kind]));
    const claimsOfSource = new Map<string, string[]>();
    for (const e of data.edges) {
      if (e.kind !== "mention") {
        continue;
      }
      const src = kindOf.get(e.source) === "source" ? e.source : e.target;
      const claim = src === e.source ? e.target : e.source;
      if (kindOf.get(src) !== "source" || kindOf.get(claim) !== "claim") {
        continue;
      }
      claimsOfSource.set(src, [...(claimsOfSource.get(src) ?? []), claim]);
    }
    const ghostsPerClaim = new Map<string, number>();
    const sourceNodes = data.nodes
      .filter((n) => n.kind === "source")
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const n of sourceNodes) {
      if (revealed.has(n.id) || n.id === selectedId) {
        continue;
      }
      const claims = claimsOfSource.get(n.id);
      if (!claims || claims.length === 0) {
        continue; // orphan evidence stays visible
      }
      const liveClaims = claims.filter((c) => !tierHidden.has(c));
      if (liveClaims.length === 0) {
        tierHidden.add(n.id);
        continue;
      }
      if (detailLevel === 0) {
        const slot = liveClaims.find((c) => (ghostsPerClaim.get(c) ?? 0) < 2);
        if (slot) {
          ghostsPerClaim.set(slot, (ghostsPerClaim.get(slot) ?? 0) + 1);
        } else {
          tierHidden.add(n.id);
        }
      }
    }
    const moreCount = [...tierHidden].filter((id) => !hidden.has(id)).length;
    for (const id of tierHidden) {
      hidden.add(id);
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
          challenges: n.challenges,
          detail: n.detail,
          study: Boolean(n.detail?.peer_reviewed),
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
        const isSelected = e.id === selectedId;
        const width = e.diagnosticity
          ? 1 + e.diagnosticity * 2.5
          : e.kind === "mention"
            ? 1
            : 1.6;
        // Contested relations wear the edge equivalent of the node corner
        // flag: a ⚑ at the midpoint, red while open, quiet once answered.
        const contested = e.challenges?.state === "contested";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          style: {
            stroke: s.stroke,
            strokeWidth: isSelected ? width + 1.4 : width,
            strokeDasharray: s.dash,
          },
          animated: e.kind === "supports" || e.kind === "contradicts",
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
    return { rfNodes, rfEdges, moreCount };
  }, [
    data,
    positions,
    selectedId,
    showSources,
    showCruxes,
    timeCap,
    claimRank,
    detailLevel,
    revealed,
  ]);

  // The Inspector's subject: a node, or a relation edge dressed as one (same
  // receipts + disputes machinery — the challenge layer keys edges as rel:…).
  const selected = useMemo((): InspectorSubject | null => {
    if (!(selectedId && data)) {
      return null;
    }
    const node = data.nodes.find((n) => n.id === selectedId);
    if (node) {
      return node;
    }
    const edge = data.edges.find((e) => e.id === selectedId);
    if (!edge?.id.startsWith("rel:")) {
      return null;
    }
    const labelOf = (id: string) => {
      const label = data.nodes.find((n) => n.id === id)?.label ?? "a claim";
      return `“${label.length > 80 ? `${label.slice(0, 80)}…` : label}”`;
    };
    return {
      id: edge.id,
      kind: "relation",
      label: `${labelOf(edge.source)} ${edge.kind.replace(/_/g, " ")} ${labelOf(edge.target)}`,
      detail: { relation: edge.kind.replace(/_/g, " ") },
    };
  }, [selectedId, data]);
  // Sidebar "Search the commons": widen to whole-commons scope and show
  // every tier (workspace fullscreens the graph; the bar focuses itself).
  useEffect(
    () =>
      graphBus.on("openCommonsSearch", () => {
        setCommonsMode(true);
        setShowSources(true);
        setDetailLevel(CLAIM_BUDGETS.length);
      }),
    []
  );

  // Tours and delegations walk nodes the model chose from the full catalog;
  // reveal them as the cursor arrives so the walk is never invisible.
  useEffect(
    () =>
      graphBus.on("revealNode", ({ nodeId }) => {
        setRevealed((prev) =>
          prev.has(nodeId) ? prev : new Set(prev).add(nodeId)
        );
      }),
    []
  );

  // Entering fullscreen brings the structured overview with it (the design's
  // "Exploration Breakdown" expanded view) — but not on the whole commons,
  // where a single-investigation breakdown makes no sense.
  useEffect(() => {
    if (full && !commonsRef.current) {
      setShowOverview(true);
    }
  }, [full]);

  // Commons scope only exists inside fullscreen search — leaving fullscreen
  // returns to this investigation at first-glance density.
  useEffect(() => {
    if (!full && commonsRef.current) {
      setCommonsMode(false);
      setDetailLevel(0);
    }
  }, [full]);

  // Let the sidebar mirror the scope: "Search the commons" reads as selected
  // while the commons is what's on screen.
  useEffect(() => {
    graphBus.emit("commonsScope", { active: commonsMode });
  }, [commonsMode]);

  // Refit the camera when the canvas or the visible set changes shape —
  // entering/leaving fullscreen, scope switches, and detail-level steps all
  // leave the old viewport pointing at the wrong extent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are re-fit TRIGGERS — the effect body deliberately reads nothing from them
  useEffect(() => {
    const t = setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.15, duration: 500 });
    }, 60);
    return () => clearTimeout(t);
  }, [full, commonsMode, detailLevel]);

  // The overview card is headed by the investigation's question — the first
  // thing a member asked — falling back to the leading hypothesis.
  const question = useMemo(() => {
    for (const m of room.data.messages ?? []) {
      if (m.role !== "user") {
        continue;
      }
      const parts = (
        m as { parts?: ReadonlyArray<{ type?: string; text?: string }> }
      ).parts;
      const text = parts
        ?.find((p) => p.type === "text" && p.text?.trim())
        ?.text?.trim();
      if (text) {
        return text.length > 140 ? `${text.slice(0, 140)}…` : text;
      }
    }
    return null;
  }, [room.data.messages]);

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

  // Every distinct contribution moment (nodes + edges, deduped, ascending) —
  // the replay bar's histogram and event-time playback both read this.
  const timeline = useMemo(() => {
    const ts = new Set<number>();
    for (const n of data?.nodes ?? []) {
      if (typeof n.t === "number") {
        ts.add(n.t);
      }
    }
    for (const e of data?.edges ?? []) {
      if (typeof e.t === "number") {
        ts.add(e.t);
      }
    }
    return [...ts].sort((a, b) => a - b);
  }, [data]);

  return (
    <div className="relative h-full w-full bg-background">
      <div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between gap-2 border-border/40 border-b bg-background/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          {full ? (
            <span className="mr-1 font-medium text-sm">
              Exploration Breakdown
            </span>
          ) : null}
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
          {/* Per-investigation surfaces — meaningless on the whole commons. */}
          {commonsMode ? null : (
            <>
              <button
                className={`${pillClass} border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground`}
                onClick={() => setShowAssessment((v) => !v)}
                type="button"
              >
                ⚖ assessment
              </button>
              <button
                className={`${pillClass} ${
                  showOverview
                    ? "border-border bg-muted text-foreground"
                    : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                } inline-flex items-center gap-1`}
                onClick={() => setShowOverview((v) => !v)}
                title="Structured overview — claims, cruxes, sources, studies"
                type="button"
              >
                <ListTreeIcon className="size-3" /> overview
              </button>
              <button
                className={`${pillClass} ${
                  showJournal
                    ? "border-border bg-muted text-foreground"
                    : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                } inline-flex items-center gap-1`}
                onClick={() => setShowJournal((v) => !v)}
                title="Investigation journal — every action eve took and why"
                type="button"
              >
                <ScrollTextIcon className="size-3" /> journal
              </button>
            </>
          )}
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
          <button
            aria-label="Refresh"
            className={iconButtonClass}
            onClick={() => load(true)}
            title="Refresh"
            type="button"
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
          {onToggleFull && !full ? (
            <button
              aria-label="Fullscreen graph"
              className={iconButtonClass}
              onClick={onToggleFull}
              title="Expand — the graph takes over the chat"
              type="button"
            >
              <Maximize2Icon className="size-3.5" />
            </button>
          ) : null}
          {full ? (
            <button
              aria-label="Exit fullscreen"
              className={iconButtonClass}
              onClick={onToggleFull}
              title="Back to chat + graph"
              type="button"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
          {onClose && !full ? (
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
        onEdgeClick={(_, edge) => {
          // Only relation edges carry a disputable assertion of their own.
          if (edge.id.startsWith("rel:")) {
            setSelectedId(edge.id);
          }
        }}
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

      {/* Progressive disclosure — the design's bottom-center expand pill. */}
      {moreCount > 0 || detailLevel > 0 ? (
        <div
          className={`-translate-x-1/2 absolute left-1/2 z-10 flex items-center gap-1.5 ${
            full ? "bottom-20" : "bottom-4"
          }`}
        >
          {moreCount > 0 ? (
            <button
              className="fade-in flex items-center gap-1 rounded-md border border-border/60 bg-background/90 px-2.5 py-1 text-muted-foreground text-xs shadow-[var(--shadow-card)] backdrop-blur transition-colors duration-150 hover:bg-muted hover:text-foreground"
              onClick={() => setDetailLevel((l) => l + 1)}
              type="button"
            >
              Expand to see more · {moreCount}
              <PlusIcon className="size-3" />
            </button>
          ) : null}
          {detailLevel > 0 ? (
            <button
              className="fade-in rounded-md border border-border/50 bg-background/90 px-2 py-1 text-muted-foreground text-xs backdrop-blur transition-colors duration-150 hover:bg-muted hover:text-foreground"
              onClick={() => {
                setDetailLevel(0);
                setRevealed(new Set());
              }}
              type="button"
            >
              Show fewer
            </button>
          ) : null}
        </div>
      ) : null}

      {showOverview && data && !commonsMode ? (
        <OverviewPanel
          data={data}
          onClose={() => setShowOverview(false)}
          question={question}
        />
      ) : null}

      {/* Rich evidence cards ride along the overview in fullscreen. */}
      {full && showOverview && data && !commonsMode ? (
        <SourceRail nodes={data.nodes} onPreview={setPreviewSource} />
      ) : null}

      {previewSource ? (
        <SourcePreview
          node={previewSource}
          onClose={() => setPreviewSource(null)}
        />
      ) : null}

      {full ? (
        <GraphSearchBar commonsMode={commonsMode} nodes={data?.nodes ?? []} />
      ) : null}

      {showJournal && !commonsMode ? (
        <JournalPanel
          investigation={investigation}
          onClose={() => setShowJournal(false)}
        />
      ) : null}

      {timeCap != null && timeBounds ? (
        <GraphTimeSlider
          max={timeBounds.max}
          min={timeBounds.min}
          onChange={setTimeCap}
          onClose={() => setTimeCap(null)}
          raised={full}
          timestamps={timeline}
          value={timeCap}
        />
      ) : null}

      {showAssessment && data?.assessment && !commonsMode ? (
        <AssessmentPanel
          assessment={data.assessment}
          onClose={() => setShowAssessment(false)}
        />
      ) : null}

      {compare ? (
        <CompareBeliefsPanel
          onClose={() => peopleBus.setCompare(null)}
          target={compare}
        />
      ) : null}

      {selected ? (
        <Inspector
          node={selected}
          onClose={() => setSelectedId(null)}
          sourceById={sourceById}
        />
      ) : null}
    </div>
  );
}
