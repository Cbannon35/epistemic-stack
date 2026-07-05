"use client";

import { useReactFlow, useStoreApi } from "@xyflow/react";
import { EyeIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useRoom } from "@/app/_components/room-provider";
import { type FollowTarget, peopleBus, usePeopleState } from "./people-bus";

const CAMERA_EVERY_MS = 550;
const CAMERA_MS = 480;
const MIN_FOLLOW_ZOOM = 0.85;
const MAX_FOLLOW_ZOOM = 1.2;

// Shadow a teammate's viewport: their cursor broadcasts (flow coordinates,
// identical layouts across clients) drive a throttled camera glide, exactly
// like following an eve tour. Any hand on the wheel breaks the spell.
// Mounted inside the ReactFlow tree (cursor layer).
export function useFollowCamera(): FollowTarget | null {
  const { channel, me } = useRoom();
  const rf = useReactFlow();
  const storeApi = useStoreApi();
  const { follow } = usePeopleState();
  const { on } = channel;

  // The followed person may have several connections (tabs) — accept cursor
  // events from any of them. Refreshed whenever presence changes.
  const targetClientIdsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!follow) {
      targetClientIdsRef.current = new Set();
      return;
    }
    targetClientIdsRef.current = new Set(
      [...channel.peers.values()]
        .filter((p) => p.userId === follow.userId && p.clientId !== me.clientId)
        .map((p) => p.clientId)
    );
  }, [channel.peers, follow, me.clientId]);

  // Camera: glide toward the followed cursor, at most every CAMERA_EVERY_MS.
  useEffect(() => {
    if (!follow) {
      return;
    }
    let lastMove = 0;
    return on("cursor", (p) => {
      if ("gone" in p || !targetClientIdsRef.current.has(p.clientId)) {
        return;
      }
      const now = performance.now();
      if (now - lastMove < CAMERA_EVERY_MS) {
        return;
      }
      lastMove = now;
      const zoom = Math.min(
        MAX_FOLLOW_ZOOM,
        Math.max(MIN_FOLLOW_ZOOM, rf.getZoom())
      );
      rf.setCenter(p.x, p.y, { duration: CAMERA_MS, zoom });
    });
  }, [follow, on, rf]);

  // Taking the wheel unfollows (setCenter animations don't fire these).
  useEffect(() => {
    if (!follow) {
      return;
    }
    const pane = storeApi.getState().domNode;
    if (!pane) {
      return;
    }
    const stop = () => peopleBus.setFollow(null);
    pane.addEventListener("wheel", stop, { passive: true });
    pane.addEventListener("pointerdown", stop);
    return () => {
      pane.removeEventListener("wheel", stop);
      pane.removeEventListener("pointerdown", stop);
    };
  }, [follow, storeApi]);

  // Unfollow someone who left the room entirely.
  useEffect(() => {
    if (!follow) {
      return;
    }
    const present = [...channel.peers.values()].some(
      (p) => p.userId === follow.userId
    );
    if (!present) {
      peopleBus.setFollow(null);
    }
  }, [channel.peers, follow]);

  return follow;
}

// Sits above the tour pill so both can show at once.
export function FollowPill({ target }: { target: FollowTarget | null }) {
  if (!target) {
    return null;
  }
  return (
    <div className="-translate-x-1/2 fade-up pointer-events-auto absolute bottom-28 left-1/2 z-20">
      <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-[var(--shadow-float)] backdrop-blur">
        <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">
          following {target.displayName.split("@")[0]}
        </span>
        <button
          className="rounded-full px-2 py-0.5 font-medium transition-[background-color,color,transform] duration-150 hover:bg-muted active:scale-[0.97] active:bg-muted"
          onClick={() => peopleBus.setFollow(null)}
          type="button"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
