"use client";

import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

// Replay bar for the graph: scrub through the commons' append-only history and
// watch the argument map assemble. The track is an activity histogram — clear
// stretches mean nothing happened, dark bands mean contributions landed — and
// ▶ steps through the distinct moments themselves, skipping the dead air.
// Layout comes from the FULL graph, so nodes hold their positions and arrive
// in place as time advances.

const BIN_COUNT = 72;
const BASE_DWELL_MS = 700;
const PER_ITEM_DWELL_MS = 150;
const MAX_DWELL_MS = 2000;
// Reaching the end holds the finished graph briefly, then returns to live.
const END_HOLD_MS = 1400;

const MOMENT_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function GraphTimeSlider({
  min,
  max,
  value,
  timestamps,
  raised = false,
  onChange,
  onClose,
}: {
  min: number;
  max: number;
  /** Current cap (epoch ms); everything after it is hidden. */
  value: number;
  /** Sorted, de-duplicated contribution timestamps (nodes + edges). */
  timestamps: readonly number[];
  /** Sit above the fullscreen search bar instead of hugging the edge. */
  raised?: boolean;
  onChange: (value: number) => void;
  onClose: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<{
    x: number;
    t: number;
    count: number;
  } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const span = Math.max(1, max - min);

  // Activity histogram: how many contributions landed in each slice of the
  // investigation's lifetime. Empty bins render nearly clear.
  const bins = useMemo(() => {
    const counts = new Array<number>(BIN_COUNT).fill(0);
    for (const t of timestamps) {
      const bin = Math.min(
        BIN_COUNT - 1,
        Math.floor(((t - min) / span) * BIN_COUNT)
      );
      counts[bin] += 1;
    }
    return counts;
  }, [timestamps, min, span]);
  const maxBin = Math.max(1, ...bins);

  // Simultaneous arrivals per distinct moment — paces playback dwell.
  const arrivalsAt = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of timestamps) {
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [timestamps]);

  // Event-time playback: hop to the next distinct timestamp, dwell in
  // proportion to how much arrived there, and skip the quiet stretches.
  // Effect Events keep the latest callbacks without resetting a pending
  // dwell timer whenever the parent re-renders.
  const onChangeEvent = useEffectEvent(onChange);
  const onCloseEvent = useEffectEvent(onClose);
  useEffect(() => {
    if (!playing) {
      return;
    }
    const next = timestamps.find((t) => t > value);
    if (next === undefined) {
      const hold = setTimeout(() => {
        setPlaying(false);
        onCloseEvent();
      }, END_HOLD_MS);
      return () => clearTimeout(hold);
    }
    const arrivals = arrivalsAt.get(next) ?? 1;
    const dwell = Math.min(
      MAX_DWELL_MS,
      BASE_DWELL_MS + (arrivals - 1) * PER_ITEM_DWELL_MS
    );
    const timer = setTimeout(() => onChangeEvent(next), dwell);
    return () => clearTimeout(timer);
  }, [playing, value, timestamps, arrivalsAt]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
    } else {
      // Starting from the end (or live) replays from the first moment.
      if (value >= max && timestamps.length > 0) {
        onChange(timestamps[0]);
      }
      setPlaying(true);
    }
  };

  const hoverAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return;
    }
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const bin = Math.min(BIN_COUNT - 1, Math.floor(frac * BIN_COUNT));
    setHover({
      x: Math.min(rect.width - 28, Math.max(28, frac * rect.width)),
      t: min + frac * span,
      count: bins[bin],
    });
  };

  const playedPct = Math.min(100, Math.max(0, ((value - min) / span) * 100));

  return (
    <div
      className={`fade-up -translate-x-1/2 absolute left-1/2 z-20 flex w-[min(520px,85%)] items-center gap-2.5 rounded-full border border-border/60 bg-background/90 py-1.5 pr-3 pl-1.5 backdrop-blur ${
        raised ? "bottom-[4.5rem]" : "bottom-3"
      }`}
    >
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

      <div
        className="relative h-4 min-w-0 flex-1 overflow-visible rounded-full focus-within:ring-1 focus-within:ring-ring"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => hoverAt(e.clientX)}
        ref={trackRef}
      >
        {/* Histogram track: clear = quiet, dark = contributions landing. */}
        <div className="absolute inset-0 flex overflow-hidden rounded-full bg-muted/40">
          {bins.map((count, i) => (
            <span
              className="h-full flex-1 bg-foreground"
              // biome-ignore lint/suspicious/noArrayIndexKey: bins are positional by construction
              key={i}
              style={{
                opacity: count === 0 ? 0.05 : 0.2 + 0.7 * (count / maxBin),
              }}
            />
          ))}
          {/* The future stays veiled until the cap reaches it. */}
          <span
            className="absolute inset-y-0 right-0 bg-background/70"
            style={{ width: `${100 - playedPct}%` }}
          />
        </div>
        {/* Playhead — red so "when are we" reads at a glance. */}
        <span
          className="-translate-x-1/2 pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-red-600"
          style={{ left: `${playedPct}%` }}
        />
        {/* Invisible range input carries dragging, keyboard, and a11y. */}
        <input
          aria-label="Replay position"
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          max={max}
          min={min}
          onChange={(e) => {
            setPlaying(false);
            onChange(Number(e.target.value));
          }}
          step={Math.max(1, Math.floor(span / 400))}
          type="range"
          value={value}
        />
        {hover ? (
          <div
            className="-top-8 -translate-x-1/2 pointer-events-none absolute whitespace-nowrap rounded-md border border-border/60 bg-background/95 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums shadow-[var(--shadow-card)]"
            style={{ left: hover.x }}
          >
            {MOMENT_FMT.format(hover.t)}
            {hover.count > 0 ? (
              <span className="text-foreground"> · {hover.count} added</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {MOMENT_FMT.format(value)}
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
