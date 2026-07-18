"use client";

import { useReactFlow, useStoreApi } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";
import { colorForUser } from "@/lib/realtime/color";

// Ping gesture: press `p` over the graph and a ripple pulses at your cursor
// position on every member's screen, in your identity color. Pings live in
// flow coordinates (like cursors) and ride their own tiny rAF loop — it only
// runs while a ripple is on screen, so the cursor layer's hot loop stays
// untouched.

const PING_LIFE_MS = 1800;
const PING_MIN_GAP_MS = 600;

type Ping = {
  id: string;
  x: number;
  y: number;
  color: string;
  displayName: string;
};

export function PingLayer() {
  const { channel, me } = useRoom();
  const rf = useReactFlow();
  const storeApi = useStoreApi();
  const [pings, setPings] = useState<Ping[]>([]);
  const elsRef = useRef(new Map<string, HTMLDivElement>());
  const pingsRef = useRef<Ping[]>([]);
  useEffect(() => {
    pingsRef.current = pings;
  }, [pings]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const overRef = useRef(false);
  const lastSentRef = useRef(0);
  const seqRef = useRef(0);
  const { on, send } = channel;

  const addPing = (ping: Ping) => {
    setPings((prev) => [...prev.slice(-7), ping]);
    setTimeout(() => {
      setPings((prev) => prev.filter((p) => p.id !== ping.id));
      elsRef.current.delete(ping.id);
    }, PING_LIFE_MS);
  };
  const addPingRef = useRef(addPing);
  useEffect(() => {
    addPingRef.current = addPing;
  });

  // ── receive ────────────────────────────────────────────────────────────────
  useEffect(
    () =>
      on("ping", (p) => {
        addPingRef.current({
          id: `${p.clientId}:${p.ts}`,
          x: p.x,
          y: p.y,
          color: p.color,
          displayName: p.displayName,
        });
      }),
    [on]
  );

  // ── track the raw pointer (independent of the cursor layer's tracker) ─────
  useEffect(() => {
    const pane = storeApi.getState().domNode;
    if (!pane) {
      return;
    }
    const onMove = (e: PointerEvent) => {
      overRef.current = true;
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      overRef.current = false;
    };
    pane.addEventListener("pointermove", onMove, { passive: true });
    pane.addEventListener("pointerleave", onLeave);
    return () => {
      pane.removeEventListener("pointermove", onMove);
      pane.removeEventListener("pointerleave", onLeave);
    };
  }, [storeApi]);

  // ── send on `p` (focus hygiene mirrors the `/` cursor-chat binding) ────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== "p" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.isComposing ||
        !overRef.current ||
        !pointerRef.current
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      const now = Date.now();
      if (now - lastSentRef.current < PING_MIN_GAP_MS) {
        return;
      }
      lastSentRef.current = now;
      const flow = rf.screenToFlowPosition(pointerRef.current);
      const color = colorForUser(me.userId);
      send("ping", {
        clientId: me.clientId,
        userId: me.userId,
        displayName: me.displayName,
        color,
        x: flow.x,
        y: flow.y,
        ts: now,
      });
      // Broadcast is self:false — echo locally.
      seqRef.current += 1;
      addPingRef.current({
        id: `${me.clientId}:${now}:${seqRef.current}`,
        x: flow.x,
        y: flow.y,
        color,
        displayName: me.displayName,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rf, send, me.clientId, me.userId, me.displayName]);

  // ── position: a rAF loop that only runs while ripples are visible ─────────
  useEffect(() => {
    if (pings.length === 0) {
      return;
    }
    let raf = 0;
    const frame = () => {
      const [vx, vy, zoom] = storeApi.getState().transform;
      for (const ping of pingsRef.current) {
        const el = elsRef.current.get(ping.id);
        if (el) {
          el.style.transform = `translate3d(${ping.x * zoom + vx}px, ${
            ping.y * zoom + vy
          }px, 0)`;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pings.length, storeApi]);

  return (
    <>
      {pings.map((ping) => (
        <div
          className="ping pointer-events-none absolute top-0 left-0"
          key={ping.id}
          ref={(el) => {
            if (el) {
              elsRef.current.set(ping.id, el);
            }
          }}
          style={{ "--ping-color": ping.color } as React.CSSProperties}
        >
          <span className="ping-ring" />
          <span className="ping-ring ping-ring-late" />
          <span
            className="ping-name absolute top-3 left-3 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium text-[9px] text-white"
            style={{ backgroundColor: ping.color }}
          >
            {ping.displayName}
          </span>
        </div>
      ))}
    </>
  );
}
