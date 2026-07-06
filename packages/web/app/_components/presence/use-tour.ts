"use client";

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useRoom } from "@/app/_components/room-provider";
import { eveMemorySnapshot, pushEveMemory } from "@/lib/realtime/eve-memory";
import { eveCursorId, type TourStepEvent } from "@/lib/realtime/types";

const STEP_STALE_MS = 20_000;
const MIN_DWELL_MS = 2600;
const MAX_DWELL_MS = 9000;
const READ_MS_PER_CHAR = 55;
const CAMERA_MS = 600;
const MIN_TOUR_ZOOM = 0.85;
const MAX_TOUR_ZOOM = 1.2;
const CONTEXT_MESSAGES = 8;
const CONTEXT_CLAMP = 320;

// The eve cursors' puppet strings, implemented by the cursor layer. Each
// concurrent tour/answer drives its own cursor (id = eveCursorId(tourId)).
export type EveDriver = {
  move: (
    id: string,
    x: number,
    y: number,
    opts?: { instant?: boolean }
  ) => void;
  say: (id: string, text: string) => void;
  hide: (id: string) => void;
};

export type TourPhase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "hosting"; tourId: string; step: number; total: number }
  | { kind: "offered"; tourId: string; hostName: string }
  | { kind: "following"; tourId: string }
  | { kind: "notice"; text: string };

type EvePlanResponse =
  | { mode: "answer"; tourId: string; answer: string }
  | {
      mode: "tour";
      tourId: string;
      intro: string;
      steps: Array<{ nodeId: string; narration: string }>;
      conclusion: string;
    };

type ActiveTour = {
  hostId: string;
  hostName: string;
  mode: "answer" | "tour";
  lastStepAt: number;
  /** The node this tour currently rings, so concurrent tours don't clobber. */
  ringNodeId: string | null;
};

function readingTime(text: string): number {
  return Math.min(
    MAX_DWELL_MS,
    Math.max(MIN_DWELL_MS, text.length * READ_MS_PER_CHAR)
  );
}

function setNodeRing(nodeId: string, on: boolean): void {
  document
    .querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
    ?.classList.toggle("tour-ring", on);
}

// "@eve <question>" → one model call decides: quick ANSWER (a bubble at the
// asker's cursor) or a TOUR (the asking client hosts; its eve cursor walks
// node-to-node, broadcasting steps so the whole room sees the walk). Multiple
// tours/answers can run at once — each gets its own eve cursor. Context from
// the room chat and prior eve exchanges rides along so eve isn't stateless.
export function useTour(eve: EveDriver) {
  const room = useRoom();
  const { channel, me, roomId } = room;
  const rf = useReactFlow();
  const [phase, setPhase] = useState<TourPhase>({ kind: "idle" });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** Eve cursor ids to render — one per live tour/answer. */
  const [eveCursors, setEveCursors] = useState<readonly string[]>([]);
  const toursRef = useRef(new Map<string, ActiveTour>());
  const cancelRef = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const { on, send, setActivity } = channel;

  const syncCursors = useCallback(() => {
    setEveCursors([...toursRef.current.keys()].map(eveCursorId));
  }, []);

  const notice = useCallback((text: string) => {
    setPhase({ kind: "notice", text });
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(() => {
      setPhase((p) => (p.kind === "notice" ? { kind: "idle" } : p));
    }, 3500);
  }, []);

  const nodeCenter = useCallback(
    (nodeId: string): { x: number; y: number } | null => {
      const node = rf.getNode(nodeId);
      if (!node) {
        return null;
      }
      return {
        x: node.position.x + (node.measured?.width ?? 200) / 2,
        y: node.position.y + (node.measured?.height ?? 60) / 2,
      };
    },
    [rf]
  );

  const applyStep = useCallback(
    (step: TourStepEvent, follow: boolean) => {
      const tour = toursRef.current.get(step.tourId);
      if (step.nodeId) {
        // The tour may visit nodes hidden by the first-glance budget.
        graphBus.emit("revealNode", { nodeId: step.nodeId });
      }
      // Resolve locally first (layouts match across clients); the broadcast
      // x/y only covers nodes missing from a stale local snapshot.
      const center = step.nodeId ? nodeCenter(step.nodeId) : null;
      const x = center?.x ?? step.x;
      const y = center?.y ?? step.y;
      const cursor = eveCursorId(step.tourId);
      eve.move(cursor, x, y, { instant: step.kind === "intro" });
      eve.say(
        cursor,
        step.kind === "step"
          ? `${step.narration}  (${step.index}/${step.total})`
          : step.narration
      );
      if (tour) {
        if (tour.ringNodeId) {
          setNodeRing(tour.ringNodeId, false);
        }
        tour.ringNodeId = step.kind === "step" ? step.nodeId : null;
        if (tour.ringNodeId) {
          setNodeRing(tour.ringNodeId, true);
        }
      }
      if (follow) {
        const zoom = Math.min(
          MAX_TOUR_ZOOM,
          Math.max(MIN_TOUR_ZOOM, rf.getZoom())
        );
        rf.setCenter(x, y, { duration: CAMERA_MS, zoom });
      }
    },
    [eve, nodeCenter, rf]
  );

  const teardown = useCallback(
    (tourId: string) => {
      const tour = toursRef.current.get(tourId);
      if (tour?.ringNodeId) {
        setNodeRing(tour.ringNodeId, false);
      }
      toursRef.current.delete(tourId);
      eve.hide(eveCursorId(tourId));
      syncCursors();
      setPhase((p) =>
        (p.kind === "offered" || p.kind === "following") && p.tourId === tourId
          ? { kind: "idle" }
          : p
      );
    },
    [eve, syncCursors]
  );

  const dwell = useCallback(async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until && !cancelRef.current) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }, []);

  const stopHosting = useCallback(
    (tourId: string, reason: "stopped" | "complete", summary?: string) => {
      send("tour-end", {
        tourId,
        hostId: me.clientId,
        reason,
        summary,
        ts: Date.now(),
      });
      cancelRef.current = true;
      teardown(tourId);
      setActivity("viewing");
      setPhase({ kind: "idle" });
    },
    [send, me.clientId, teardown, setActivity]
  );

  // Recent room chat + the ROOM's prior eve exchanges → eve's context window.
  // Memory is room-wide (shared via the eve-memory broadcast), so one member's
  // question builds on another's.
  const buildContext = useCallback((): string => {
    const messages = roomRef.current.data.messages ?? [];
    const transcript = messages
      .slice(-CONTEXT_MESSAGES)
      .map((m) => {
        const text = m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => (p.type === "text" ? p.text : ""))
          .join(" ")
          .slice(0, CONTEXT_CLAMP);
        return text ? `${m.role}: ${text}` : null;
      })
      .filter(Boolean)
      .join("\n");
    const currentRoom = roomRef.current.roomId;
    const memory = currentRoom ? eveMemorySnapshot(currentRoom).join("\n") : "";
    return [
      transcript ? `Chat transcript (recent):\n${transcript}` : null,
      memory ? `Your recent exchanges in this room:\n${memory}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }, []);

  const remember = useCallback(
    (question: string, reply: string) => {
      const currentRoom = roomRef.current.roomId;
      if (!currentRoom) {
        return;
      }
      const ts = Date.now();
      const entry = `Q (${new Date(ts).toISOString().slice(11, 16)}): ${question}\nA: ${reply.slice(0, 300)}`;
      pushEveMemory(currentRoom, entry, ts);
      send("eve-memory", { entry, ts });
    },
    [send]
  );

  // Peers' exchanges join the same ring.
  useEffect(
    () =>
      on("eve-memory", (p) => {
        const currentRoom = roomRef.current.roomId;
        if (currentRoom) {
          pushEveMemory(currentRoom, p.entry, p.ts);
        }
      }),
    [on]
  );

  const start = useCallback(
    async (question: string, origin?: { x: number; y: number }) => {
      const current = phaseRef.current;
      if (current.kind === "hosting" || current.kind === "requesting") {
        notice("you're already running one — Escape to stop it");
        return;
      }
      if (!roomId) {
        notice("start the investigation first");
        return;
      }
      setPhase({ kind: "requesting" });
      setActivity("touring");
      let plan: EvePlanResponse;
      try {
        const res = await fetch("/api/tour", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question,
            investigation: roomId,
            context: buildContext(),
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(err?.error ?? "the guide is unavailable");
        }
        plan = (await res.json()) as EvePlanResponse;
      } catch (error) {
        notice(error instanceof Error ? error.message : "eve is unavailable");
        setActivity("viewing");
        return;
      }

      cancelRef.current = false;
      const totalSteps = plan.mode === "tour" ? plan.steps.length : 0;
      toursRef.current.set(plan.tourId, {
        hostId: me.clientId,
        hostName: me.displayName,
        mode: plan.mode,
        lastStepAt: Date.now(),
        ringNodeId: null,
      });
      syncCursors();
      send("tour-start", {
        tourId: plan.tourId,
        hostId: me.clientId,
        hostName: me.displayName,
        question,
        mode: plan.mode,
        totalSteps,
        ts: Date.now(),
      });

      const emit = (
        step: Omit<TourStepEvent, "tourId" | "hostId" | "ts">,
        follow: boolean
      ): void => {
        const tour = toursRef.current.get(plan.tourId);
        if (!tour) {
          return;
        }
        tour.lastStepAt = Date.now();
        const full: TourStepEvent = {
          ...step,
          tourId: plan.tourId,
          hostId: me.clientId,
          ts: Date.now(),
        };
        send("tour-step", full);
        applyStep(full, follow);
      };

      // Where eve appears first: the asker's cursor, else viewport center.
      const viewport = rf.getViewport();
      const pane = document.querySelector(".react-flow");
      const rect = pane?.getBoundingClientRect();
      const fallback = {
        x: rect ? (rect.width / 2 - viewport.x) / viewport.zoom : 0,
        y: rect ? (rect.height / 2 - viewport.y) / viewport.zoom : 0,
      };
      const spawn = origin ?? fallback;

      if (plan.mode === "answer") {
        // Quick reply: eve pops in at the asker's cursor, answers, leaves.
        emit(
          {
            kind: "intro",
            index: 0,
            total: 0,
            nodeId: null,
            narration: plan.answer,
            x: spawn.x,
            y: spawn.y,
          },
          false
        );
        setPhase({ kind: "idle" });
        setActivity("viewing");
        remember(question, plan.answer);
        await dwell(readingTime(plan.answer));
        send("tour-end", {
          tourId: plan.tourId,
          hostId: me.clientId,
          reason: "complete",
          ts: Date.now(),
        });
        teardown(plan.tourId);
        return;
      }

      setPhase({
        kind: "hosting",
        tourId: plan.tourId,
        step: 0,
        total: totalSteps,
      });
      emit(
        {
          kind: "intro",
          index: 0,
          total: totalSteps,
          nodeId: null,
          narration: plan.intro,
          x: spawn.x,
          y: spawn.y,
        },
        true
      );
      await dwell(readingTime(plan.intro));

      let index = 0;
      for (const step of plan.steps) {
        if (cancelRef.current) {
          break;
        }
        const center = nodeCenter(step.nodeId);
        if (!center) {
          continue; // Node vanished from this snapshot — skip the stop.
        }
        index += 1;
        setPhase({
          kind: "hosting",
          tourId: plan.tourId,
          step: index,
          total: totalSteps,
        });
        emit(
          {
            kind: "step",
            index,
            total: totalSteps,
            nodeId: step.nodeId,
            narration: step.narration,
            x: center.x,
            y: center.y,
          },
          true
        );
        await dwell(readingTime(step.narration));
      }

      if (!cancelRef.current) {
        emit(
          {
            kind: "conclusion",
            index: totalSteps,
            total: totalSteps,
            nodeId: null,
            narration: plan.conclusion,
            x: 0,
            y: 0,
          },
          false
        );
        remember(question, plan.conclusion);
        await dwell(readingTime(plan.conclusion));
        stopHosting(plan.tourId, "complete", plan.conclusion);
      }
    },
    [
      roomId,
      me,
      rf,
      send,
      applyStep,
      nodeCenter,
      dwell,
      notice,
      setActivity,
      stopHosting,
      teardown,
      syncCursors,
      buildContext,
      remember,
    ]
  );

  // ── follower side ──────────────────────────────────────────────────────────

  useEffect(
    () =>
      on("tour-start", (p) => {
        if (p.hostId === me.clientId) {
          return;
        }
        toursRef.current.set(p.tourId, {
          hostId: p.hostId,
          hostName: p.hostName,
          mode: p.mode,
          lastStepAt: Date.now(),
          ringNodeId: null,
        });
        syncCursors();
        // Only full tours offer camera-follow; answers are just a bubble.
        if (p.mode === "tour" && phaseRef.current.kind === "idle") {
          setPhase({ kind: "offered", tourId: p.tourId, hostName: p.hostName });
        }
      }),
    [on, me.clientId, syncCursors]
  );

  useEffect(
    () =>
      on("tour-step", (p) => {
        const tour = toursRef.current.get(p.tourId);
        if (!tour) {
          return;
        }
        tour.lastStepAt = Date.now();
        if (p.hostId === me.clientId) {
          return;
        }
        applyStep(
          p,
          phaseRef.current.kind === "following" &&
            phaseRef.current.tourId === p.tourId
        );
      }),
    [on, applyStep, me.clientId]
  );

  useEffect(
    () =>
      on("tour-end", (p) => {
        if (!toursRef.current.has(p.tourId)) {
          return;
        }
        teardown(p.tourId);
        if (p.summary && p.reason === "complete") {
          notice(`✦ ${p.summary.slice(0, 140)}`);
        }
      }),
    [on, teardown, notice]
  );

  // A vanished host (closed tab, dropped socket) never sends tour-end: reap
  // foreign tours after prolonged step silence.
  useEffect(() => {
    const timer = setInterval(() => {
      for (const [tourId, tour] of toursRef.current) {
        if (
          tour.hostId !== me.clientId &&
          Date.now() - tour.lastStepAt > STEP_STALE_MS
        ) {
          teardown(tourId);
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [me.clientId, teardown]);

  // Leaving the room mid-hosting ends my tours for everyone.
  useEffect(
    () => () => {
      for (const [tourId, tour] of toursRef.current) {
        if (tour.hostId === me.clientId) {
          send("tour-end", {
            tourId,
            hostId: me.clientId,
            reason: "stopped",
            ts: Date.now(),
          });
        }
      }
      cancelRef.current = true;
    },
    [me.clientId, send]
  );

  const follow = useCallback(() => {
    const p = phaseRef.current;
    if (p.kind === "offered") {
      setPhase({ kind: "following", tourId: p.tourId });
    }
  }, []);

  const unfollow = useCallback(() => {
    setPhase((p) =>
      p.kind === "following" || p.kind === "offered" ? { kind: "idle" } : p
    );
  }, []);

  const stop = useCallback(() => {
    const p = phaseRef.current;
    if (p.kind === "hosting") {
      stopHosting(p.tourId, "stopped");
    }
  }, [stopHosting]);

  return { phase, eveCursors, start, follow, unfollow, stop };
}
