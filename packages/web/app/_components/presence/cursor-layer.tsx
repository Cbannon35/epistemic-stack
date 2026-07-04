"use client";

import { useReactFlow, useStoreApi } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CursorRefs,
  RemoteCursor,
} from "@/app/_components/presence/cursor";
import { TourPill } from "@/app/_components/presence/tour-pill";
import { type EveDriver, useTour } from "@/app/_components/presence/use-tour";
import { useRoom } from "@/app/_components/room-provider";
import { EVE_COLOR } from "@/lib/realtime/color";
import { EVE_CURSOR_ID } from "@/lib/realtime/types";
import { throttle } from "@/lib/throttle";

const CURSOR_SEND_MS = 40;
const CHAT_SEND_MS = 90;
const CURSOR_STALE_MS = 6000;
const BUBBLE_FADE_MS = 4000;
const CHAT_IDLE_CLOSE_MS = 10_000;

type Remote = {
  tx: number;
  ty: number;
  x: number;
  y: number;
  hasPos: boolean;
  lastTs: number;
  chatTs: number;
  /** Pin cursor + bubble visible regardless of timers (eve mid-narration). */
  hold: boolean;
  /** Damping time constant (ms) — eve glides slower than a human hand. */
  tau: number;
  el: HTMLDivElement | null;
  bubble: HTMLDivElement | null;
};

// Live cursors over the graph, Figma-style. Screen-space overlay: React only
// renders the LIST of peers (presence changes); every per-frame position runs
// through refs + one rAF loop writing transforms directly, with the viewport
// transform read inside the loop — pointer movement and pan/zoom cause zero
// React re-renders. The `/` cursor chat input rides the own pointer, and the
// eve tour cursor is one more entry in the same registry.
export function CursorLayer() {
  const { channel, me } = useRoom();
  const rf = useReactFlow();
  const storeApi = useStoreApi();
  const remotesRef = useRef(new Map<string, Remote>());
  const ownPosRef = useRef<{ x: number; y: number } | null>(null);
  const pointerOverRef = useRef(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const chatWrapRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const chatIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { on, send, setActivity } = channel;

  const ensureRemote = useCallback((id: string): Remote => {
    let remote = remotesRef.current.get(id);
    if (!remote) {
      remote = {
        tx: 0,
        ty: 0,
        x: 0,
        y: 0,
        hasPos: false,
        lastTs: 0,
        chatTs: 0,
        hold: false,
        tau: id === EVE_CURSOR_ID ? 250 : 60,
        el: null,
        bubble: null,
      };
      remotesRef.current.set(id, remote);
    }
    return remote;
  }, []);

  // The eve tour cursor is driven imperatively through the same registry.
  const eveDriver = useMemo<EveDriver>(
    () => ({
      move: (x, y, opts) => {
        const eve = ensureRemote(EVE_CURSOR_ID);
        eve.tx = x;
        eve.ty = y;
        if (opts?.instant || !eve.hasPos) {
          eve.x = x;
          eve.y = y;
          eve.hasPos = true;
        }
        eve.hold = true;
        eve.lastTs = performance.now();
      },
      say: (text) => {
        const eve = ensureRemote(EVE_CURSOR_ID);
        if (eve.bubble) {
          eve.bubble.textContent = text;
        }
        eve.chatTs = performance.now();
      },
      hide: () => {
        const eve = ensureRemote(EVE_CURSOR_ID);
        eve.hold = false;
        eve.lastTs = 0;
        eve.chatTs = 0;
      },
    }),
    [ensureRemote]
  );

  const tour = useTour(eveDriver);
  const tourRef = useRef(tour);
  tourRef.current = tour;

  const registerRefs = useCallback(
    (id: string, refs: Partial<CursorRefs>) => {
      const remote = ensureRemote(id);
      if ("root" in refs) {
        remote.el = refs.root ?? null;
      }
      if ("bubble" in refs) {
        remote.bubble = refs.bubble ?? null;
      }
    },
    [ensureRemote]
  );

  // ── receive: cursor positions ──────────────────────────────────────────────
  useEffect(
    () =>
      on("cursor", (p) => {
        const remote = ensureRemote(p.clientId);
        if ("gone" in p) {
          remote.lastTs = 0;
          return;
        }
        remote.tx = p.x;
        remote.ty = p.y;
        if (!remote.hasPos) {
          remote.x = p.x;
          remote.y = p.y;
          remote.hasPos = true;
        }
        remote.lastTs = performance.now();
      }),
    [on, ensureRemote]
  );

  // ── receive: cursor chat (direct DOM writes, no state at keystroke rate) ──
  useEffect(
    () =>
      on("cursor-chat", (p) => {
        const remote = ensureRemote(p.clientId);
        if (p.done && p.text === "") {
          remote.chatTs = 0;
          return;
        }
        if (remote.bubble) {
          remote.bubble.textContent = p.text;
        }
        remote.chatTs = performance.now();
        // A committed message also refreshes the cursor so the bubble anchors.
        remote.lastTs = Math.max(remote.lastTs, remote.chatTs);
      }),
    [on, ensureRemote]
  );

  // ── the one rAF loop ───────────────────────────────────────────────────────
  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    let raf = 0;
    let prev = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(64, now - prev);
      prev = now;
      const [vx, vy, zoom] = storeApi.getState().transform;
      for (const remote of remotesRef.current.values()) {
        const { el } = remote;
        if (!el) {
          continue;
        }
        const stale =
          remote.lastTs === 0 ||
          (now - remote.lastTs > CURSOR_STALE_MS && !remote.hold);
        if (stale) {
          el.style.opacity = "0";
          continue;
        }
        const k = reduced ? 1 : 1 - Math.exp(-dt / remote.tau);
        remote.x += (remote.tx - remote.x) * k;
        remote.y += (remote.ty - remote.y) * k;
        el.style.opacity = "1";
        el.style.transform = `translate3d(${remote.x * zoom + vx}px, ${
          remote.y * zoom + vy
        }px, 0)`;
        if (remote.bubble) {
          remote.bubble.classList.toggle(
            "bubble-hidden",
            !remote.hold &&
              (remote.chatTs === 0 || now - remote.chatTs > BUBBLE_FADE_MS)
          );
        }
      }
      // Own chat input rides the raw pointer (already pane-relative).
      const wrap = chatWrapRef.current;
      const own = ownPosRef.current;
      if (wrap && own) {
        wrap.style.transform = `translate3d(${own.x}px, ${own.y}px, 0)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [storeApi]);

  // A window resuming from a background freeze shows its last painted frame;
  // snap stale cursors hidden instantly instead of letting the opacity
  // transition play a half-second "ghost" fade.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const now = performance.now();
      for (const remote of remotesRef.current.values()) {
        const stale =
          remote.lastTs === 0 ||
          (now - remote.lastTs > CURSOR_STALE_MS && !remote.hold);
        const { el } = remote;
        if (stale && el) {
          el.style.transition = "none";
          el.style.opacity = "0";
          requestAnimationFrame(() => {
            el.style.transition = "";
          });
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── send: own pointer in flow coordinates ─────────────────────────────────
  useEffect(() => {
    const pane = storeApi.getState().domNode;
    if (!pane) {
      return;
    }
    const sendCursor = throttle((clientX: number, clientY: number) => {
      const flow = rf.screenToFlowPosition({ x: clientX, y: clientY });
      send("cursor", {
        clientId: me.clientId,
        x: flow.x,
        y: flow.y,
        ts: Date.now(),
      });
    }, CURSOR_SEND_MS);
    const onMove = (e: PointerEvent) => {
      pointerOverRef.current = true;
      const rect = pane.getBoundingClientRect();
      ownPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      sendCursor(e.clientX, e.clientY);
    };
    const onLeave = () => {
      pointerOverRef.current = false;
      send("cursor", { clientId: me.clientId, gone: true, ts: Date.now() });
    };
    pane.addEventListener("pointermove", onMove, { passive: true });
    pane.addEventListener("pointerleave", onLeave);
    return () => {
      pane.removeEventListener("pointermove", onMove);
      pane.removeEventListener("pointerleave", onLeave);
    };
  }, [storeApi, rf, send, me.clientId]);

  // ── cursor chat: sending ───────────────────────────────────────────────────
  const sendChatRef = useRef(
    throttle((text: string) => {
      send("cursor-chat", {
        clientId: me.clientId,
        text,
        done: false,
        ts: Date.now(),
      });
    }, CHAT_SEND_MS)
  );

  const closeChat = useCallback(
    (broadcast: boolean) => {
      setChatOpen(false);
      setChatText("");
      setActivity("viewing");
      if (chatIdleTimer.current) {
        clearTimeout(chatIdleTimer.current);
        chatIdleTimer.current = null;
      }
      if (broadcast) {
        send("cursor-chat", {
          clientId: me.clientId,
          text: "",
          done: true,
          ts: Date.now(),
        });
      }
    },
    [send, setActivity, me.clientId]
  );

  const bumpIdleTimer = useCallback(() => {
    if (chatIdleTimer.current) {
      clearTimeout(chatIdleTimer.current);
    }
    chatIdleTimer.current = setTimeout(
      () => closeChat(true),
      CHAT_IDLE_CLOSE_MS
    );
  }, [closeChat]);

  const handleChatChange = (value: string) => {
    setChatText(value);
    sendChatRef.current(value);
    bumpIdleTimer();
  };

  const commitChat = () => {
    const text = chatText.trim();
    if (text.startsWith("@eve")) {
      const question = text.replace(/^@eve\s*/, "");
      closeChat(true);
      if (question) {
        tourRef.current.start(question);
      }
      return;
    }
    if (text) {
      send("cursor-chat", {
        clientId: me.clientId,
        text,
        done: true,
        ts: Date.now(),
      });
    }
    closeChat(!text);
  };

  // ── '/' keybinding (with focus hygiene) + Escape stops a hosted tour ──────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (chatOpen) {
        return; // The input's own handlers take over.
      }
      if (e.key === "Escape") {
        tourRef.current.stop();
        return;
      }
      if (
        e.key !== "/" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.isComposing ||
        !pointerOverRef.current
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      e.preventDefault();
      setChatOpen(true);
      setActivity("chatting");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, setActivity]);

  // Any user-initiated pan/zoom while following the tour stops the camera sync
  // (the tour's own setCenter animations don't fire these listeners).
  const following = tour.phase.kind === "following";
  useEffect(() => {
    if (!following) {
      return;
    }
    const pane = storeApi.getState().domNode;
    if (!pane) {
      return;
    }
    const stop = () => tourRef.current.unfollow();
    pane.addEventListener("wheel", stop, { passive: true });
    pane.addEventListener("pointerdown", stop);
    return () => {
      pane.removeEventListener("wheel", stop);
      pane.removeEventListener("pointerdown", stop);
    };
  }, [following, storeApi]);

  useEffect(() => {
    if (chatOpen) {
      chatInputRef.current?.focus();
      bumpIdleTimer();
    }
  }, [chatOpen, bumpIdleTimer]);

  const peers = [...channel.peers.values()].filter(
    (p) => p.clientId !== me.clientId
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {peers.map((peer) => (
        <RemoteCursor
          color={peer.color}
          displayName={peer.displayName}
          id={peer.clientId}
          key={peer.clientId}
          register={registerRefs}
        />
      ))}
      <RemoteCursor
        color={EVE_COLOR}
        displayName="eve"
        id={EVE_CURSOR_ID}
        key={EVE_CURSOR_ID}
        register={registerRefs}
      />
      <TourPill
        onFollow={tour.follow}
        onStop={tour.stop}
        onUnfollow={tour.unfollow}
        phase={tour.phase}
      />
      {chatOpen ? (
        <div
          className="absolute top-0 left-0 will-change-transform"
          ref={chatWrapRef}
        >
          <div className="pointer-events-auto mt-4 ml-4">
            <input
              className="w-52 rounded-lg rounded-tl-sm border bg-background/95 px-2 py-1 text-foreground text-xs shadow-[var(--shadow-float)] outline-none backdrop-blur placeholder:text-muted-foreground"
              maxLength={200}
              onBlur={() => closeChat(true)}
              onChange={(e) => handleChatChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitChat();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeChat(true);
                }
              }}
              placeholder="Say something · @eve to ask"
              ref={chatInputRef}
              type="text"
              value={chatText}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
