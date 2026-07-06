"use client";

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import type { EveDriver } from "@/app/_components/presence/use-tour";
import { useRoom } from "@/app/_components/room-provider";
import type {
  DelegationAdvance,
  DelegationBeat,
  DelegationSummary,
} from "@/lib/delegate/types";
import { pushEveMemory } from "@/lib/realtime/eve-memory";
import {
  type DelegationStepEvent,
  delegateCursorId,
} from "@/lib/realtime/types";

// Delegated eve investigations, client side. The delegator's tab HOSTS the run
// (tour pattern): it drives short POSTs through the phase machine, plays each
// returned beat on its own eve cursor, and broadcasts every beat so the whole
// room watches the same crawl. Any number of runs — from any mix of members —
// can be live at once; each gets its own cursor (eve:dg:<id>).

const MIN_DWELL_MS = 2600;
const MAX_DWELL_MS = 9000;
const RECORD_MIN_DWELL_MS = 1600;
const RECORD_MAX_DWELL_MS = 4200;
const READ_MS_PER_CHAR = 55;
// Synthesis is one model call plus commons writes — beats go quiet meanwhile,
// so foreign runs only reap after a long silence.
const RUN_STALE_MS = 90_000;
const REAP_SWEEP_MS = 10_000;
const ERROR_CLEAR_MS = 5000;

type ActiveRun = {
  hostId: string;
  hostName: string;
  brief: string;
  lastStepAt: number;
  ringNodeId: string | null;
  cancelled: boolean;
  /** Last position the cursor moved to (beats without a node stay put). */
  x: number;
  y: number;
  hasPos: boolean;
};

// Which runs THIS TAB is hosting, in sessionStorage: per-tab like hosting
// itself, but it survives a refresh — so a reloaded delegator resumes driving
// instead of orphaning the run to the reaper. (A second tab of the same user
// deliberately does NOT pick it up.)
const HOSTED_KEY = "epistack-hosted-delegations";

function readHosted(): string[] {
  try {
    const raw = sessionStorage.getItem(HOSTED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function markHosted(delegationId: string, hosting: boolean): void {
  try {
    const next = readHosted().filter((id) => id !== delegationId);
    if (hosting) {
      next.push(delegationId);
    }
    sessionStorage.setItem(HOSTED_KEY, JSON.stringify(next.slice(-8)));
  } catch {
    // Storage unavailable — the reaper story still applies.
  }
}

/** Live (unpersisted) narration per run, for the dock's activity line. */
export type LiveLine = { kind: DelegationBeat["kind"]; narration: string };

export type DelegationsApi = {
  /** Cursor ids to render (one per live run, any host). */
  cursors: readonly string[];
  rows: DelegationSummary[];
  live: ReadonlyMap<string, LiveLine>;
  /** Brief currently being planned (before the run has an id). */
  pending: string | null;
  error: string | null;
  start: (brief: string, origin?: { x: number; y: number }) => Promise<void>;
  cancel: (delegationId: string) => void;
  refetch: () => void;
};

function readingTime(text: string, min = MIN_DWELL_MS, max = MAX_DWELL_MS) {
  return Math.min(max, Math.max(min, text.length * READ_MS_PER_CHAR));
}

function setDelegateRing(nodeId: string, on: boolean): void {
  document
    .querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
    ?.classList.toggle("delegate-ring", on);
}

export function useDelegations(eve: EveDriver): DelegationsApi {
  const room = useRoom();
  const { channel, me, roomId } = room;
  const { on, send } = channel;
  const rf = useReactFlow();
  const runsRef = useRef(new Map<string, ActiveRun>());
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [rows, setRows] = useState<DelegationSummary[]>([]);
  const [live, setLive] = useState<ReadonlyMap<string, LiveLine>>(new Map());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  const syncCursors = useCallback(() => {
    setCursors([...runsRef.current.keys()].map(delegateCursorId));
  }, []);

  const setLiveLine = useCallback((id: string, line: LiveLine | null) => {
    setLive((prev) => {
      const next = new Map(prev);
      if (line) {
        next.set(id, line);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const fail = useCallback((message: string) => {
    setError(message);
    if (errorTimer.current) {
      clearTimeout(errorTimer.current);
    }
    errorTimer.current = setTimeout(() => setError(null), ERROR_CLEAR_MS);
  }, []);

  // Closes over roomId so the mount effect refires when a fresh chat's first
  // send assigns the session id.
  const refetch = useCallback(async () => {
    if (!roomId) {
      return;
    }
    const res = await fetch(
      `/api/delegate?investigation=${encodeURIComponent(roomId)}`
    ).catch(() => null);
    if (!res?.ok) {
      return;
    }
    const data = (await res.json()) as { delegations: DelegationSummary[] };
    setRows(data.delegations);
  }, [roomId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

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

  const teardown = useCallback(
    (delegationId: string) => {
      const run = runsRef.current.get(delegationId);
      if (run?.ringNodeId) {
        setDelegateRing(run.ringNodeId, false);
      }
      runsRef.current.delete(delegationId);
      eve.hide(delegateCursorId(delegationId));
      syncCursors();
      setLiveLine(delegationId, null);
    },
    [eve, syncCursors, setLiveLine]
  );

  /** Move/say/ring for one beat — used by host and followers alike. */
  const applyStep = useCallback(
    (step: DelegationStepEvent) => {
      const run = runsRef.current.get(step.delegationId);
      if (step.nodeId) {
        // eve examines nodes the first-glance budget may be hiding.
        graphBus.emit("revealNode", { nodeId: step.nodeId });
      }
      const center = step.nodeId ? nodeCenter(step.nodeId) : null;
      const x = center?.x ?? step.x;
      const y = center?.y ?? step.y;
      const cursor = delegateCursorId(step.delegationId);
      eve.move(cursor, x, y, { instant: run ? !run.hasPos : false });
      eve.say(cursor, step.narration);
      if (run) {
        run.x = x;
        run.y = y;
        run.hasPos = true;
        run.lastStepAt = Date.now();
        if (run.ringNodeId) {
          setDelegateRing(run.ringNodeId, false);
        }
        run.ringNodeId = step.nodeId;
        if (run.ringNodeId) {
          setDelegateRing(run.ringNodeId, true);
        }
      }
      setLiveLine(step.delegationId, {
        kind: step.kind,
        narration: step.narration,
      });
    },
    [eve, nodeCenter, setLiveLine]
  );

  const dwell = useCallback(async (ms: number, run: ActiveRun) => {
    const until = Date.now() + ms;
    while (Date.now() < until && !run.cancelled) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }, []);

  // ── hosting ────────────────────────────────────────────────────────────────

  const playBeats = useCallback(
    async (delegationId: string, beats: DelegationBeat[], run: ActiveRun) => {
      let index = 0;
      for (const beat of beats) {
        if (run.cancelled) {
          return;
        }
        index += 1;
        const center = beat.nodeId ? nodeCenter(beat.nodeId) : null;
        const step: DelegationStepEvent = {
          delegationId,
          hostId: me.clientId,
          kind: beat.kind,
          index,
          total: beats.length,
          nodeId: beat.nodeId,
          narration: beat.narration,
          x: center?.x ?? run.x,
          y: center?.y ?? run.y,
          ts: Date.now(),
        };
        send("delegation-step", step);
        applyStep(step);
        await dwell(
          beat.kind === "record"
            ? readingTime(
                beat.narration,
                RECORD_MIN_DWELL_MS,
                RECORD_MAX_DWELL_MS
              )
            : readingTime(beat.narration),
          run
        );
      }
    },
    [me.clientId, send, applyStep, dwell, nodeCenter]
  );

  /** A synthetic beat while a phase call is in flight — heartbeat + honesty. */
  const working = useCallback(
    (delegationId: string, run: ActiveRun, narration: string) => {
      const step: DelegationStepEvent = {
        delegationId,
        hostId: me.clientId,
        kind: "research",
        index: 0,
        total: 0,
        nodeId: null,
        narration,
        x: run.x,
        y: run.y,
        ts: Date.now(),
      };
      send("delegation-step", step);
      applyStep(step);
    },
    [me.clientId, send, applyStep]
  );

  const finish = useCallback(
    (
      delegationId: string,
      run: ActiveRun,
      reason: "complete" | "cancelled" | "error",
      summary?: string
    ) => {
      send("delegation-end", {
        delegationId,
        hostId: me.clientId,
        reason,
        summary,
        ts: Date.now(),
      });
      markHosted(delegationId, false);
      // A landed investigation joins the room-wide eve memory, so follow-up
      // @eve questions can build on what she just found.
      if (reason === "complete" && summary && roomIdRef.current) {
        const ts = Date.now();
        const entry = `You ran a delegated investigation "${run.brief.slice(0, 120)}" — result: ${summary.slice(0, 300)}`;
        pushEveMemory(roomIdRef.current, entry, ts);
        send("eve-memory", { entry, ts });
      }
      teardown(delegationId);
      run.cancelled = true;
      refetch().catch(() => {
        // Next refetch (broadcast or reopen) will catch the row up.
      });
    },
    [send, me.clientId, teardown, refetch]
  );

  // The step loop, shared by a fresh start and a post-refresh resume: play any
  // beats in hand, then keep asking the phase machine for more until done. The
  // server row carries the phase cursor, so the loop itself is stateless.
  const drive = useCallback(
    async (
      delegationId: string,
      run: ActiveRun,
      initial: DelegationAdvance | null
    ) => {
      let advance = initial;
      if (advance) {
        await playBeats(delegationId, advance.beats, run);
      }
      while (!(advance?.done || run.cancelled)) {
        working(
          delegationId,
          run,
          advance ? "working on it…" : "picking the run back up…"
        );
        try {
          const res = await fetch("/api/delegate/step", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ delegationId }),
          });
          if (!res.ok) {
            throw new Error("step failed");
          }
          advance = (await res.json()) as DelegationAdvance;
        } catch {
          if (!run.cancelled) {
            finish(delegationId, run, "error");
            fail("eve hit an error mid-run");
          }
          return;
        }
        await playBeats(delegationId, advance.beats, run);
      }
      if (!run.cancelled) {
        finish(delegationId, run, "complete", advance?.summary);
      }
    },
    [playBeats, working, finish, fail]
  );

  // Where a hosted cursor first appears: a given origin, else viewport center.
  const spawnPoint = useCallback(
    (origin?: { x: number; y: number }): { x: number; y: number } => {
      if (origin) {
        return origin;
      }
      const viewport = rf.getViewport();
      const pane = document.querySelector(".react-flow");
      const rect = pane?.getBoundingClientRect();
      return {
        x: rect ? (rect.width / 2 - viewport.x) / viewport.zoom : 0,
        y: rect ? (rect.height / 2 - viewport.y) / viewport.zoom : 0,
      };
    },
    [rf]
  );

  const start = useCallback(
    async (brief: string, origin?: { x: number; y: number }) => {
      const sessionId = roomIdRef.current;
      const trimmed = brief.trim();
      if (!sessionId) {
        fail("start the investigation first");
        return;
      }
      if (!trimmed) {
        return;
      }
      setPending(trimmed);
      let advance: DelegationAdvance;
      try {
        const res = await fetch("/api/delegate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, brief: trimmed }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(err?.error ?? "eve couldn't take this one");
        }
        advance = (await res.json()) as DelegationAdvance;
      } catch (cause) {
        setPending(null);
        fail(cause instanceof Error ? cause.message : "eve is unavailable");
        return;
      }
      setPending(null);
      markHosted(advance.delegationId, true);

      // Where the cursor first appears: the delegator's pointer, else center.
      const spawn = spawnPoint(origin);
      const run: ActiveRun = {
        hostId: me.clientId,
        hostName: me.displayName,
        brief: trimmed,
        lastStepAt: Date.now(),
        ringNodeId: null,
        cancelled: false,
        x: spawn.x,
        y: spawn.y,
        hasPos: false,
      };
      runsRef.current.set(advance.delegationId, run);
      syncCursors();
      send("delegation-start", {
        delegationId: advance.delegationId,
        hostId: me.clientId,
        hostName: me.displayName,
        brief: trimmed,
        ts: Date.now(),
      });
      refetch().catch(() => {
        // Dock refresh is best-effort; broadcasts carry the live view.
      });

      // Let React commit the new cursor before the first beat, so the plan
      // narration lands in a mounted bubble instead of a null ref.
      await new Promise((r) => setTimeout(r, 50));
      await drive(advance.delegationId, run, advance);
    },
    [
      me.clientId,
      me.displayName,
      send,
      syncCursors,
      refetch,
      fail,
      drive,
      spawnPoint,
    ]
  );

  // ── resume after a refresh ─────────────────────────────────────────────────
  // A reload never runs unmount cleanup, so my running rows stay `running`
  // server-side with their phase cursor intact. Once the dock list loads,
  // re-adopt any run this tab was hosting and keep driving it.
  const resumeTriedRef = useRef(new Set<string>());
  useEffect(() => {
    const hosted = readHosted();
    for (const row of rows) {
      if (
        row.status !== "running" ||
        row.delegatorId !== me.userId ||
        !hosted.includes(row.id) ||
        runsRef.current.has(row.id) ||
        resumeTriedRef.current.has(row.id)
      ) {
        continue;
      }
      resumeTriedRef.current.add(row.id);
      const spawn = spawnPoint();
      const run: ActiveRun = {
        hostId: me.clientId,
        hostName: me.displayName,
        brief: row.brief,
        lastStepAt: Date.now(),
        ringNodeId: null,
        cancelled: false,
        x: spawn.x,
        y: spawn.y,
        hasPos: false,
      };
      runsRef.current.set(row.id, run);
      syncCursors();
      send("delegation-start", {
        delegationId: row.id,
        hostId: me.clientId,
        hostName: me.displayName,
        brief: row.brief,
        ts: Date.now(),
      });
      setLiveLine(row.id, {
        kind: "research",
        narration: "picking the run back up…",
      });
      drive(row.id, run, null).catch(() => {
        // drive() surfaces its own error state.
      });
    }
  }, [
    rows,
    me.userId,
    me.clientId,
    me.displayName,
    send,
    syncCursors,
    setLiveLine,
    drive,
    spawnPoint,
  ]);

  const cancel = useCallback(
    (delegationId: string) => {
      const run = runsRef.current.get(delegationId);
      if (run && run.hostId === me.clientId) {
        run.cancelled = true;
      }
      markHosted(delegationId, false);
      fetch("/api/delegate/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delegationId }),
        keepalive: true,
      }).catch(() => {
        // The stale-heartbeat reaper marks it interrupted server-side.
      });
      send("delegation-end", {
        delegationId,
        hostId: me.clientId,
        reason: "cancelled",
        ts: Date.now(),
      });
      teardown(delegationId);
      refetch().catch(() => {
        // Best-effort.
      });
    },
    [me.clientId, send, teardown, refetch]
  );

  // ── following ──────────────────────────────────────────────────────────────

  useEffect(
    () =>
      on("delegation-start", (p) => {
        if (p.hostId === me.clientId) {
          return;
        }
        runsRef.current.set(p.delegationId, {
          hostId: p.hostId,
          hostName: p.hostName,
          brief: p.brief,
          lastStepAt: Date.now(),
          ringNodeId: null,
          cancelled: false,
          x: 0,
          y: 0,
          hasPos: false,
        });
        syncCursors();
        setLiveLine(p.delegationId, {
          kind: "plan",
          narration: `investigating for ${p.hostName}…`,
        });
        refetch().catch(() => {
          // Best-effort.
        });
      }),
    [on, me.clientId, syncCursors, setLiveLine, refetch]
  );

  useEffect(
    () =>
      on("delegation-step", (p) => {
        if (p.hostId === me.clientId) {
          return;
        }
        // A late joiner missed delegation-start — adopt the run mid-crawl.
        if (!runsRef.current.has(p.delegationId)) {
          runsRef.current.set(p.delegationId, {
            hostId: p.hostId,
            hostName: "eve",
            brief: "",
            lastStepAt: Date.now(),
            ringNodeId: null,
            cancelled: false,
            x: p.x,
            y: p.y,
            hasPos: false,
          });
          syncCursors();
        }
        applyStep(p);
      }),
    [on, me.clientId, applyStep, syncCursors]
  );

  useEffect(
    () =>
      on("delegation-end", (p) => {
        if (!runsRef.current.has(p.delegationId)) {
          return;
        }
        teardown(p.delegationId);
        refetch().catch(() => {
          // Best-effort.
        });
      }),
    [on, teardown, refetch]
  );

  // A vanished host never sends delegation-end: reap foreign runs after
  // prolonged silence (the list endpoint reports the row as interrupted).
  useEffect(() => {
    const timer = setInterval(() => {
      for (const [id, run] of runsRef.current) {
        if (
          run.hostId !== me.clientId &&
          Date.now() - run.lastStepAt > RUN_STALE_MS
        ) {
          teardown(id);
        }
      }
    }, REAP_SWEEP_MS);
    return () => clearInterval(timer);
  }, [me.clientId, teardown]);

  // Leaving the room mid-run cancels my delegations for everyone.
  useEffect(
    () => () => {
      for (const [id, run] of runsRef.current) {
        if (run.hostId === me.clientId) {
          run.cancelled = true;
          markHosted(id, false);
          send("delegation-end", {
            delegationId: id,
            hostId: me.clientId,
            reason: "cancelled",
            ts: Date.now(),
          });
          fetch("/api/delegate/cancel", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ delegationId: id }),
            keepalive: true,
          }).catch(() => {
            // The reaper covers it.
          });
        }
      }
    },
    [me.clientId, send]
  );

  return { cursors, rows, live, pending, error, start, cancel, refetch };
}
