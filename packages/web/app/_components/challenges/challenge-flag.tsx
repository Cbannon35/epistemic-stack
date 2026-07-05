import type { CSSProperties } from "react";
import type { NodeChallengeSummary } from "@/lib/challenge-types";

export const CONTESTED_COLOR = "#dc2626";

// Corner flag on a graph node carrying its dispute state: red while any
// challenge is open (contested), quiet once every challenge has a response
// (answered). Absent entirely for undisputed nodes — silence means silence.
export function ChallengeFlag({
  challenges,
}: {
  challenges?: NodeChallengeSummary;
}) {
  if (!challenges) {
    return null;
  }
  const contested = challenges.state === "contested";
  const style: CSSProperties = {
    position: "absolute",
    top: -8,
    right: -8,
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    borderRadius: 999,
    padding: "1px 5px",
    fontSize: 8,
    fontWeight: 700,
    fontStyle: "normal",
    lineHeight: 1.6,
    letterSpacing: 0,
    color: contested ? "#fff" : "var(--muted-foreground)",
    background: contested ? CONTESTED_COLOR : "var(--muted)",
    border: `1px solid ${contested ? CONTESTED_COLOR : "var(--border)"}`,
  };
  const title = contested
    ? `${challenges.open} open challenge${challenges.open === 1 ? "" : "s"} — contested`
    : `challenged · all ${challenges.total} answered`;
  return (
    <span style={style} title={title}>
      ⚑ {contested ? challenges.open : challenges.total}
    </span>
  );
}
