"use client";

import { PanelRightOpenIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AgentChat } from "@/app/_components/agent-chat";
import { RoomTicker } from "@/app/_components/awareness/ticker";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { GraphPanel } from "@/app/_components/graph-panel";
import { ShortcutOverlay } from "@/app/_components/onboarding/shortcut-overlay";
import { usePeopleState } from "@/app/_components/people/people-bus";
import { useRoom } from "@/app/_components/room-provider";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { dedupeByUser } from "@/lib/realtime/types";

const MIN_CHAT_PX = 380;
const MIN_GRAPH_PX = 340;
const DEFAULT_GRAPH_PCT = 54;
const KEY_STEP_PCT = 3;

// Chat | resizable divider | graph. The divider is hand-rolled (pointer
// capture) so we don't pull in a panels library for one vertical split.
export function Workspace() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const dragPctRef = useRef<number | null>(null);
  const [graphOpen, setGraphOpen] = useState(true);
  // Fullscreen "Exploration Breakdown": the graph takes over the chat; a
  // floating "Open Research Agent" pill (or the header ✕) brings it back.
  const [graphFull, setGraphFull] = useState(false);
  // Graph share of the split, in percent — stays proportional on window resize.
  const [graphPct, setGraphPct] = useState(DEFAULT_GRAPH_PCT);
  const [dragging, setDragging] = useState(false);
  const { channel } = useRoom();
  const { setView } = channel;

  // Clicking a tool card in the chat always reveals the graph it points into,
  // and the chat's Delegate button reveals the dock that lives on the graph.
  useEffect(() => graphBus.on("focusNode", () => setGraphOpen(true)), []);
  useEffect(() => graphBus.on("openDelegate", () => setGraphOpen(true)), []);
  // "Search the commons" lives on the graph, expanded all the way.
  useEffect(
    () =>
      graphBus.on("openCommonsSearch", () => {
        setGraphOpen(true);
        setGraphFull(true);
      }),
    []
  );

  // Following someone who's in the graph pane reveals the graph here too.
  const { follow } = usePeopleState();
  const peers = channel.peers;
  useEffect(() => {
    if (!follow) {
      return;
    }
    const person = dedupeByUser(peers.values()).find(
      (p) => p.userId === follow.userId
    );
    if (person?.view === "graph") {
      setGraphOpen(true);
    }
  }, [follow, peers]);

  // Your avatar follows your pointer between panes (chat header ↔ graph
  // toolbar). Closing the graph puts you back in chat.
  useEffect(() => {
    if (!graphOpen) {
      setView("chat");
    }
  }, [graphOpen, setView]);

  // Fullscreen pins your avatar to the graph — wherever the pointer wanders
  // (header, sidebar, menus), there's no chat pane to return to.
  useEffect(() => {
    if (graphFull) {
      setView("graph");
    } else if (graphOpen) {
      setView("chat");
    }
  }, [graphFull, graphOpen, setView]);

  // Clamp so neither pane collapses below its usable minimum.
  const clampPct = (pct: number) => {
    const total = containerRef.current?.getBoundingClientRect().width ?? 0;
    if (total === 0) {
      return pct;
    }
    const min = (MIN_GRAPH_PX / total) * 100;
    const max = ((total - MIN_CHAT_PX) / total) * 100;
    return Math.min(Math.max(pct, min), Math.max(min, max));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!(rect?.width && graphRef.current)) {
      return;
    }
    const pct = clampPct(((rect.right - e.clientX) / rect.width) * 100);
    dragPctRef.current = pct;
    // Write the width straight to the DOM during the drag — committing state
    // per move would re-render the graph at pointer speed.
    graphRef.current.style.width = `${pct}%`;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
      return;
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    if (dragPctRef.current !== null) {
      setGraphPct(dragPctRef.current);
      dragPctRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
      return;
    }
    e.preventDefault();
    setGraphPct((pct) =>
      clampPct(pct + (e.key === "ArrowLeft" ? KEY_STEP_PCT : -KEY_STEP_PCT))
    );
  };

  return (
    <div
      className={`flex h-dvh w-full ${dragging ? "select-none" : ""}`}
      ref={containerRef}
    >
      <ShortcutOverlay />
      <div
        className={`h-full min-w-0 flex-1 flex-col ${graphFull ? "hidden" : "flex"}`}
      >
        <AgentChat
          headerActions={
            graphOpen ? null : (
              <button
                className="hidden items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-[background-color,border-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] active:bg-muted md:inline-flex"
                onClick={() => setGraphOpen(true)}
                type="button"
              >
                <PanelRightOpenIcon className="size-3.5" />
                Show graph
              </button>
            )
          }
        />
      </div>

      {graphOpen && !graphFull ? (
        // biome-ignore lint/a11y/useSemanticElements: an <hr> can't be an interactive window splitter
        <div
          aria-label="Resize graph panel"
          aria-orientation="vertical"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(graphPct)}
          className="group relative z-10 hidden w-1.5 shrink-0 cursor-col-resize touch-none md:block"
          onDoubleClick={() => setGraphPct(DEFAULT_GRAPH_PCT)}
          onKeyDown={handleKeyDown}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          role="separator"
          tabIndex={0}
          title="Drag to resize · double-click to reset"
        >
          <div
            className={`-translate-x-1/2 absolute inset-y-0 left-1/2 w-px transition-colors duration-150 group-hover:w-0.5 group-hover:bg-ring group-focus-visible:bg-ring ${
              dragging ? "w-0.5 bg-ring" : "bg-border"
            }`}
          />
        </div>
      ) : null}

      <div
        className={`hidden h-full min-w-0 flex-col overflow-hidden md:flex ${
          dragging ? "" : "transition-[width] duration-200 ease-out"
        }`}
        onPointerEnter={() => setView("graph")}
        onPointerLeave={() => {
          // In fullscreen there is no chat to be "in" — you live on the graph.
          if (!graphFull) {
            setView("chat");
          }
        }}
        ref={graphRef}
        style={{
          width: graphFull ? "100%" : graphOpen ? `${graphPct}%` : "0%",
        }}
      >
        <div className="relative min-h-0 flex-1">
          <GraphPanel
            full={graphFull}
            onClose={() => setGraphOpen(false)}
            onToggleFull={() => setGraphFull((v) => !v)}
          />
        </div>
        {graphFull ? <FullscreenComposer /> : null}
      </div>

      <RoomTicker />
    </div>
  );
}

// The design keeps the composer under the fullscreen graph — you can keep
// asking without leaving the Exploration Breakdown. Mirrors the chat
// composer's turn locking; the transcript itself stays one pill away.
function FullscreenComposer() {
  const room = useRoom();
  const busy = room.status === "submitted" || room.status === "streaming";
  const foreignTurn =
    room.activeTurn && !room.activeTurn.mine
      ? (room.authors.get(room.activeTurn.turnId)?.displayName ??
        "another researcher")
      : null;

  const handleSubmit = (message: { text?: string }, event: FormEvent) => {
    event.preventDefault();
    const text = message.text?.trim();
    if (!text || busy || room.completed) {
      return;
    }
    room.send({ message: text });
  };

  return (
    <div className="border-border/40 border-t bg-background/85 px-4 py-3 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            disabled={room.completed}
            placeholder={
              room.completed
                ? "This investigation has concluded."
                : foreignTurn
                  ? `${foreignTurn} is asking…`
                  : "Ask clarifying questions…"
            }
          />
          <PromptInputSubmit
            disabled={busy || room.completed}
            status={room.status}
          />
        </PromptInput>
      </div>
    </div>
  );
}
