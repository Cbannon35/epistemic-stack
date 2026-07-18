"use client";

import { SparklesIcon } from "lucide-react";
import { isEveCursorId } from "@/lib/realtime/types";

// Presentational cursor shell. The layer's rAF loop positions the root div
// (transform) and toggles bubble visibility — nothing here re-renders at
// pointer speed.

export type CursorRefs = {
  root: HTMLDivElement | null;
  bubble: HTMLDivElement | null;
};

/** The bare pointer glyph — shared by live cursors and the parking lot. */
export function CursorGlyph({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      className="drop-shadow-sm"
      fill="none"
      height="18"
      viewBox="0 0 16 18"
      width="16"
    >
      <path
        d="M1.5 1.2L14 8.4L8.1 9.9L5.2 16.3L1.5 1.2Z"
        fill={color}
        stroke="var(--background)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function RemoteCursor({
  id,
  displayName,
  color,
  register,
}: {
  id: string;
  displayName: string;
  color: string;
  register: (id: string, refs: Partial<CursorRefs>) => void;
}) {
  const isEve = isEveCursorId(id);
  return (
    <div
      className="cursor-pop absolute top-0 left-0 opacity-0 transition-opacity duration-300 will-change-transform"
      ref={(el) => register(id, { root: el })}
    >
      {isEve ? (
        // Eve variants (tour violet, delegate fuchsia) differ only by `color`.
        <span
          className="eve-halo flex size-6 items-center justify-center rounded-full text-white shadow-[var(--shadow-float)]"
          style={{ backgroundColor: color }}
        >
          <SparklesIcon className="size-3.5" />
        </span>
      ) : (
        <CursorGlyph color={color} />
      )}
      <div className="mt-1 ml-3 flex flex-col items-start gap-1">
        <span
          className="whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium text-[10px] text-white leading-none"
          style={{ backgroundColor: color }}
        >
          {displayName}
        </span>
        <div
          className={`cursor-bubble bubble-hidden ${
            isEve ? "max-w-72" : "max-w-56"
          } whitespace-pre-wrap rounded-lg rounded-tl-sm border bg-background/95 px-2 py-1 text-foreground text-xs shadow-[var(--shadow-float)] backdrop-blur`}
          ref={(el) => register(id, { bubble: el })}
          style={{ borderColor: color }}
        />
      </div>
    </div>
  );
}
