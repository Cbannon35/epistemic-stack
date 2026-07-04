"use client";

import { SparklesIcon } from "lucide-react";
import type { TourPhase } from "@/app/_components/presence/use-tour";

const pillButton =
  "rounded-full px-2 py-0.5 font-medium transition-[background-color,color,transform] duration-150 hover:bg-muted active:scale-[0.97] active:bg-muted";

// Bottom-center status pill for the eve tour: host controls, follower opt-in,
// transient notices. Hidden when idle.
export function TourPill({
  phase,
  onFollow,
  onUnfollow,
  onStop,
}: {
  phase: TourPhase;
  onFollow: () => void;
  onUnfollow: () => void;
  onStop: () => void;
}) {
  if (phase.kind === "idle") {
    return null;
  }

  return (
    <div className="-translate-x-1/2 fade-up pointer-events-auto absolute bottom-16 left-1/2 z-20">
      <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-[var(--shadow-float)] backdrop-blur">
        <SparklesIcon className="size-3.5 shrink-0 text-[#7c3aed]" />
        {phase.kind === "requesting" ? (
          <span className="text-muted-foreground">
            eve is preparing a tour…
          </span>
        ) : null}
        {phase.kind === "hosting" ? (
          <>
            <span className="text-muted-foreground">
              touring · {phase.step}/{phase.total}
            </span>
            <button className={pillButton} onClick={onStop} type="button">
              Stop
            </button>
          </>
        ) : null}
        {phase.kind === "offered" ? (
          <>
            <span className="text-muted-foreground">
              eve is touring for {phase.hostName}
            </span>
            <button className={pillButton} onClick={onFollow} type="button">
              Follow
            </button>
            <button
              className={`${pillButton} text-muted-foreground`}
              onClick={onUnfollow}
              type="button"
            >
              dismiss
            </button>
          </>
        ) : null}
        {phase.kind === "following" ? (
          <>
            <span className="text-muted-foreground">following the tour</span>
            <button className={pillButton} onClick={onUnfollow} type="button">
              Stop following
            </button>
          </>
        ) : null}
        {phase.kind === "watching" ? (
          <span className="text-muted-foreground">tour in progress</span>
        ) : null}
        {phase.kind === "notice" ? (
          <span className="max-w-80 truncate text-muted-foreground">
            {phase.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
