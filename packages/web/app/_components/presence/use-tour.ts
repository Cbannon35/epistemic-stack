"use client";

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";
import type { TourStepEvent } from "@/lib/realtime/types";

const STEP_STALE_MS = 15_000;
const MIN_DWELL_MS = 2600;
const MAX_DWELL_MS = 9000;
const READ_MS_PER_CHAR = 55;
const CAMERA_MS = 600;
const MIN_TOUR_ZOOM = 0.85;
const MAX_TOUR_ZOOM = 1.2;

// The eve cursor's puppet strings, implemented by the cursor layer.
export type EveDriver = {
  move: (x: number, y: number, opts?: { instant?: boolean }) => void;
  say: (text: string) => void;
  hide: () => void;
};

export type TourPhase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "hosting"; tourId: string; step: number; total: number }
  | { kind: "offered"; tourId: string; hostName: string }
  | { kind: "following"; tourId: string }
  | { kind: "watching"; tourId: string }
  | { kind: "notice"; text: string };

type TourPlanResponse = {
  tourId: string;
  intro: string;
  steps: Array<{ nodeId: string; narration: string }>;
  conclusion: string;
};

function readingTime(text: string): number {
  return Math.min(
    MAX_DWELL_MS,
    Math.max(MIN_DWELL_MS, text.length * READ_MS_PER_CHAR)
  );
}

function highlightNode(nodeId: string | null): void {
  for (const el of document.querySelectorAll(".react-flow__node.tour-ring")) {
    el.classList.remove("tour-ring");
  }
  if (nodeId) {
    document
      .querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
      ?.classList.add("tour-ring");
  }
}

// "@eve <question>" → the asking client HOSTS: it fetches a tour plan, then
// walks the eve cursor node-to-node, broadcasting each step so every member
// sees the same walk. Followers resolve node positions against their own
// layout (identical by construction) and may opt into camera-follow.
export function useTour(eve: EveDriver) {
  const { channel, me, roomId } = useRoom();
  const rf = useReactFlow();
  const [phase, setPhase] = useState<TourPhase>({ kind: "idle" });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // The room's single live tour (host or foreign), for concurrency + staleness.
  const activeRef = useRef<{
    tourId: string;
    hostId: string;
    lastStepAt: number;
  } | null>(null);
  const cancelRef = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { on, send, setActivity } = channel;

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
      // Resolve locally first (layouts match across clients); the broadcast
      // x/y only covers nodes missing from a stale local snapshot.
      const center = step.nodeId ? nodeCenter(step.nodeId) : null;
      const x = center?.x ?? step.x;
      const y = center?.y ?? step.y;
      eve.move(x, y, { instant: step.kind === "intro" });
      eve.say(
        step.kind === "step"
          ? `${step.narration}  (${step.index}/${step.total})`
          : step.narration
      );
      highlightNode(step.kind === "step" ? step.nodeId : null);
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

  const teardown = useCallback(() => {
    activeRef.current = null;
    highlightNode(null);
    eve.hide();
  }, [eve]);

  const dwell = useCallback(async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until && !cancelRef.current) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }, []);

  const stopHosting = useCallback(
    (reason: "stopped" | "complete", summary?: string) => {
      const active = activeRef.current;
      if (active) {
        send("tour-end", {
          tourId: active.tourId,
          hostId: me.clientId,
          reason,
          summary,
          ts: Date.now(),
        });
      }
      cancelRef.current = true;
      teardown();
      setActivity("viewing");
      setPhase({ kind: "idle" });
    },
    [send, me.clientId, teardown, setActivity]
  );

  const start = useCallback(
    async (question: string) => {
      if (activeRef.current) {
        notice("a tour is already running");
        return;
      }
      if (!roomId) {
        notice("start the investigation first");
        return;
      }
      setPhase({ kind: "requesting" });
      setActivity("touring");
      let plan: TourPlanResponse;
      try {
        const res = await fetch("/api/tour", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, investigation: roomId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(err?.error ?? "the guide is unavailable");
        }
        plan = (await res.json()) as TourPlanResponse;
      } catch (error) {
        notice(error instanceof Error ? error.message : "tour failed");
        setActivity("viewing");
        return;
      }

      cancelRef.current = false;
      activeRef.current = {
        tourId: plan.tourId,
        hostId: me.clientId,
        lastStepAt: Date.now(),
      };
      send("tour-start", {
        tourId: plan.tourId,
        hostId: me.clientId,
        hostName: me.displayName,
        question,
        totalSteps: plan.steps.length,
        ts: Date.now(),
      });

      const emit = (
        step: Omit<TourStepEvent, "tourId" | "hostId" | "ts">
      ): void => {
        const active = activeRef.current;
        if (!active) {
          return;
        }
        active.lastStepAt = Date.now();
        const full: TourStepEvent = {
          ...step,
          tourId: active.tourId,
          hostId: me.clientId,
          ts: Date.now(),
        };
        send("tour-step", full);
        applyStep(full, true);
      };

      // Intro: eve appears at the current viewport center.
      const viewport = rf.getViewport();
      const pane = document.querySelector(".react-flow");
      const rect = pane?.getBoundingClientRect();
      const cx = rect ? (rect.width / 2 - viewport.x) / viewport.zoom : 0;
      const cy = rect ? (rect.height / 2 - viewport.y) / viewport.zoom : 0;
      setPhase({
        kind: "hosting",
        tourId: plan.tourId,
        step: 0,
        total: plan.steps.length,
      });
      emit({
        kind: "intro",
        index: 0,
        total: plan.steps.length,
        nodeId: null,
        narration: plan.intro,
        x: cx,
        y: cy,
      });
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
          total: plan.steps.length,
        });
        emit({
          kind: "step",
          index,
          total: plan.steps.length,
          nodeId: step.nodeId,
          narration: step.narration,
          x: center.x,
          y: center.y,
        });
        await dwell(readingTime(step.narration));
      }

      if (!cancelRef.current) {
        emit({
          kind: "conclusion",
          index: plan.steps.length,
          total: plan.steps.length,
          nodeId: null,
          narration: plan.conclusion,
          x: 0,
          y: 0,
        });
        await dwell(readingTime(plan.conclusion));
        stopHosting("complete", plan.conclusion);
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
    ]
  );

  // ── follower side ──────────────────────────────────────────────────────────

  useEffect(
    () =>
      on("tour-start", (p) => {
        const current = phaseRef.current;
        if (current.kind === "hosting" || current.kind === "requesting") {
          // Two hosts raced: the lexicographically larger tourId yields.
          const mine = activeRef.current;
          if (mine && mine.tourId > p.tourId) {
            stopHosting("stopped");
          } else {
            return;
          }
        }
        activeRef.current = {
          tourId: p.tourId,
          hostId: p.hostId,
          lastStepAt: Date.now(),
        };
        setPhase({ kind: "offered", tourId: p.tourId, hostName: p.hostName });
      }),
    [on, stopHosting]
  );

  useEffect(
    () =>
      on("tour-step", (p) => {
        const active = activeRef.current;
        if (!active || active.tourId !== p.tourId) {
          return;
        }
        active.lastStepAt = Date.now();
        if (p.hostId === me.clientId) {
          return;
        }
        applyStep(p, phaseRef.current.kind === "following");
      }),
    [on, applyStep, me.clientId]
  );

  useEffect(
    () =>
      on("tour-end", (p) => {
        const active = activeRef.current;
        if (!active || active.tourId !== p.tourId) {
          return;
        }
        teardown();
        if (p.summary && p.reason === "complete") {
          notice(`✦ ${p.summary.slice(0, 140)}`);
        } else {
          setPhase({ kind: "idle" });
        }
      }),
    [on, teardown, notice]
  );

  // A vanished host (closed tab, dropped socket) never sends tour-end: reap
  // the tour after 15s of step silence.
  useEffect(() => {
    const timer = setInterval(() => {
      const active = activeRef.current;
      if (
        active &&
        active.hostId !== me.clientId &&
        Date.now() - active.lastStepAt > STEP_STALE_MS
      ) {
        teardown();
        setPhase({ kind: "idle" });
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [me.clientId, teardown]);

  // Leaving the room mid-hosting ends the tour for everyone.
  useEffect(
    () => () => {
      if (activeRef.current?.hostId === me.clientId) {
        stopHosting("stopped");
      }
    },
    [me.clientId, stopHosting]
  );

  const follow = useCallback(() => {
    const active = activeRef.current;
    if (active) {
      setPhase({ kind: "following", tourId: active.tourId });
    }
  }, []);

  const unfollow = useCallback(() => {
    const active = activeRef.current;
    if (active) {
      setPhase({ kind: "watching", tourId: active.tourId });
    }
  }, []);

  const stop = useCallback(() => {
    if (phaseRef.current.kind === "hosting") {
      stopHosting("stopped");
    }
  }, [stopHosting]);

  return { phase, start, follow, unfollow, stop };
}
