"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";
import { submitCredence } from "@/app/(chat)/credence-actions";
import { colorForUser } from "@/lib/realtime/color";
import type { CredenceDetail } from "./types";

// The belief timeline for one hypothesis: community average, an append-only
// trajectory sparkline, and a control to register YOUR credence. The write is
// a receipted assessment — history is never edited, so the sparkline is the
// community literally changing its mind.

const SPARK_W = 260;
const SPARK_H = 56;
const PAD = 6;

function formatDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// The community mean as it stood after each entry (latest per assessor).
function meanSeries(
  history: CredenceDetail["history"]
): Array<{ t: number; avg: number }> {
  const latest = new Map<string, number>();
  return history.map((entry) => {
    latest.set(entry.assessorId, entry.value);
    let sum = 0;
    for (const v of latest.values()) {
      sum += v;
    }
    return { t: entry.t, avg: sum / latest.size };
  });
}

function Sparkline({ history }: { history: CredenceDetail["history"] }) {
  const { points, dots, span } = useMemo(() => {
    const ts = history.map((h) => h.t);
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    const range = Math.max(1, max - min);
    const x = (t: number) => PAD + ((t - min) / range) * (SPARK_W - PAD * 2);
    const y = (v: number) => PAD + (1 - v) * (SPARK_H - PAD * 2);
    const series = meanSeries(history);
    // Stepped line: belief holds until the next entry moves it.
    const segments: string[] = [];
    for (let i = 0; i < series.length; i++) {
      const px = x(series[i].t);
      const py = y(series[i].avg);
      if (i === 0) {
        segments.push(`M ${px} ${py}`);
      } else {
        segments.push(`H ${px}`, `V ${py}`);
      }
    }
    segments.push(`H ${SPARK_W - PAD}`);
    return {
      points: segments.join(" "),
      dots: history.map((h) => ({
        cx: x(h.t),
        cy: y(h.value),
        color: colorForUser(h.assessorId),
        key: `${h.assessorId}:${h.t}`,
        title: `${h.assessorName}: ${Math.round(h.value * 100)}%`,
      })),
      span:
        max - min > 0
          ? `${formatDay(min)} – ${formatDay(max)}`
          : formatDay(min),
    };
  }, [history]);

  return (
    <div>
      <svg
        aria-label="Community credence over time"
        className="w-full"
        height={SPARK_H}
        role="img"
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      >
        {/* 50% guide */}
        <line
          stroke="var(--border)"
          strokeDasharray="3 4"
          strokeWidth={1}
          x1={PAD}
          x2={SPARK_W - PAD}
          y1={SPARK_H / 2}
          y2={SPARK_H / 2}
        />
        <path
          d={points}
          fill="none"
          stroke="#7c3aed"
          strokeLinejoin="round"
          strokeWidth={1.5}
        />
        {dots.map((d) => (
          <circle cx={d.cx} cy={d.cy} fill={d.color} key={d.key} r={2.5}>
            <title>{d.title}</title>
          </circle>
        ))}
      </svg>
      <p className="text-right text-[9px] text-muted-foreground">{span}</p>
    </div>
  );
}

export function CredenceSection({
  hypothesisId,
  credence,
}: {
  hypothesisId: string;
  credence: CredenceDetail | null;
}) {
  const room = useRoom();
  const mine = useMemo(() => {
    const entries = credence?.history.filter(
      (h) => h.assessorId === room.me.userId
    );
    return entries?.at(-1) ?? null;
  }, [credence, room.me.userId]);
  const [value, setValue] = useState(() =>
    Math.round((mine?.value ?? 0.5) * 100)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // A fresh graph payload (someone registered a credence) resyncs the slider
  // to your latest on-record value.
  useEffect(() => {
    if (mine) {
      setValue(Math.round(mine.value * 100));
    }
  }, [mine]);

  const submit = async () => {
    setSaving(true);
    try {
      await submitCredence({
        hypothesisId,
        value,
        sessionId: room.roomId,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  // Latest per assessor for the chip row.
  const latest = useMemo(() => {
    const byAssessor = new Map<
      string,
      { assessorId: string; assessorName: string; value: number }
    >();
    for (const entry of credence?.history ?? []) {
      byAssessor.set(entry.assessorId, entry);
    }
    return [...byAssessor.values()];
  }, [credence]);

  return (
    <div className="space-y-2.5">
      <p className="font-medium text-muted-foreground text-xs">
        Community credence
      </p>
      {credence ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-[#7c3aed] text-lg tabular-nums">
              {Math.round(credence.average * 100)}%
            </span>
            <span className="text-[10px] text-muted-foreground">
              {credence.assessors} assessor{credence.assessors === 1 ? "" : "s"}
              {" · "}
              {credence.history.length} update
              {credence.history.length === 1 ? "" : "s"}
            </span>
          </div>
          {credence.history.length > 1 ? (
            <Sparkline history={credence.history} />
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {latest.map((entry) => (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                key={entry.assessorId}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: colorForUser(entry.assessorId) }}
                />
                {entry.assessorName.split("@")[0]}:{" "}
                <span className="text-foreground tabular-nums">
                  {Math.round(entry.value * 100)}%
                </span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          No one has registered a credence yet. Beliefs are attributed and
          append-only — the record shows how the community's view moved.
        </p>
      )}
      <div className="space-y-1.5 rounded-md border border-border/50 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {mine ? "Update your credence" : "Register your credence"}
          </span>
          <span className="font-medium text-xs tabular-nums">{value}%</span>
        </div>
        <input
          aria-label="Your credence"
          className="w-full accent-[#7c3aed]"
          max={100}
          min={0}
          onChange={(e) => setValue(Number(e.target.value))}
          type="range"
          value={value}
        />
        <button
          className="w-full rounded-md border border-border/60 py-1 text-xs transition-[background-color,border-color,color,transform] duration-150 hover:bg-muted active:scale-[0.98] disabled:opacity-50"
          disabled={saving}
          onClick={submit}
          type="button"
        >
          {saved ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckIcon className="size-3" /> on the record
            </span>
          ) : saving ? (
            "recording…"
          ) : (
            "Record credence"
          )}
        </button>
      </div>
    </div>
  );
}
