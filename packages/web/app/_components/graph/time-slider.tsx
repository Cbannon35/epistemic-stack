"use client";

import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Replay bar for the graph: scrub through the commons' append-only history and
// watch the argument map assemble. Layout comes from the FULL graph, so nodes
// hold their positions and pop in place as time advances.

const SWEEP_MS = 10_000;
const TICK_MS = 40;

function formatMoment(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function GraphTimeSlider({
  min,
  max,
  value,
  onChange,
  onClose,
}: {
  min: number;
  max: number;
  /** Current cap (epoch ms); everything after it is hidden. */
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!playing) {
      return;
    }
    const step = ((max - min) * TICK_MS) / SWEEP_MS;
    const timer = setInterval(() => {
      const next = valueRef.current + Math.max(1, step);
      if (next >= max) {
        onChange(max);
        setPlaying(false);
      } else {
        onChange(next);
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, min, max, onChange]);

  const togglePlay = () => {
    // Replaying from the end starts over.
    if (!playing && valueRef.current >= max) {
      onChange(min);
    }
    setPlaying((p) => !p);
  };

  return (
    <div className="fade-up -translate-x-1/2 absolute bottom-3 left-1/2 z-10 flex w-[min(480px,85%)] items-center gap-2.5 rounded-full border border-border/60 bg-background/90 py-1.5 pr-3 pl-1.5 backdrop-blur">
      <button
        aria-label={playing ? "Pause replay" : "Play replay"}
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-150 active:scale-95"
        onClick={togglePlay}
        type="button"
      >
        {playing ? (
          <PauseIcon className="size-3" />
        ) : (
          <PlayIcon className="ml-0.5 size-3" />
        )}
      </button>
      <input
        aria-label="Replay position"
        className="min-w-0 flex-1 accent-foreground"
        max={max}
        min={min}
        onChange={(e) => {
          setPlaying(false);
          onChange(Number(e.target.value));
        }}
        step={Math.max(1, Math.floor((max - min) / 400))}
        type="range"
        value={value}
      />
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {formatMoment(value)}
      </span>
      <button
        aria-label="Exit replay"
        className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
