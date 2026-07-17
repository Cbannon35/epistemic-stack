import {
  Handle,
  type NodeProps,
  type NodeTypes,
  Position,
} from "@xyflow/react";
import type { CSSProperties } from "react";
import { ChallengeFlag } from "@/app/_components/challenges/challenge-flag";

// Pill-first node language (Particularity Designs / eve): a small colored
// kind pill with plain text beneath it, on the dotted canvas — no card boxes.
// Sources and studies render as "ghosts" (dashed ring + muted text) so
// evidence is present without shouting over the argument.
export const KIND_PILL: Record<
  "hypothesis" | "claim" | "crux" | "source",
  { bg: string; fg: string; label: string }
> = {
  hypothesis: { bg: "#f6dc7d", fg: "#7a5c10", label: "Hypothesis" },
  claim: { bg: "#d8e5ff", fg: "#3c66c4", label: "Claim" },
  crux: { bg: "#fad3d0", fg: "#c04440", label: "Crux" },
  source: { bg: "transparent", fg: "#98a0ab", label: "Source" },
};

const handleStyle: CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: "none",
  background: "transparent",
};

function Handles() {
  return (
    <>
      <Handle
        isConnectable={false}
        position={Position.Top}
        style={handleStyle}
        type="target"
      />
      <Handle
        isConnectable={false}
        position={Position.Bottom}
        style={handleStyle}
        type="source"
      />
    </>
  );
}

const clamp = (lines: number): CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

function Pill({
  kind,
  selected,
}: {
  kind: keyof typeof KIND_PILL;
  selected?: boolean;
}) {
  const pill = KIND_PILL[kind];
  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 600,
        background: pill.bg,
        color: pill.fg,
        boxShadow: selected ? "0 0 0 2px var(--foreground)" : undefined,
      }}
    >
      {pill.label}
    </span>
  );
}

export function ClaimNode({ data, selected }: NodeProps<any>) {
  return (
    <div
      className="graph-node"
      data-incoming={data.incoming || undefined}
      style={{ width: 180, textAlign: "center" }}
    >
      <Handles />
      <ChallengeFlag challenges={data.challenges} />
      <Pill kind="claim" selected={selected} />
      <div
        style={{
          ...clamp(3),
          marginTop: 4,
          fontSize: 11,
          lineHeight: 1.4,
          color: "var(--foreground)",
        }}
      >
        {data.label}
      </div>
      {data.sources > 1 ? (
        <div
          style={{
            marginTop: 2,
            fontSize: 9,
            color: "var(--muted-foreground)",
          }}
        >
          {data.sources} sources
        </div>
      ) : null}
    </div>
  );
}

// Evidence ghosts: dashed ring + muted label. `data.study` marks
// peer-reviewed sources, which read as "Study" per the design.
export function SourceNode({ data, selected }: NodeProps<any>) {
  const ghost = KIND_PILL.source.fg;
  return (
    <div
      className="graph-node"
      data-incoming={data.incoming || undefined}
      style={{ width: 150, textAlign: "center" }}
    >
      <Handles />
      <ChallengeFlag challenges={data.challenges} />
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 10,
          fontWeight: 600,
          color: ghost,
        }}
      >
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: data.study ? 3 : 999,
            border: `1.5px dashed ${selected ? "var(--foreground)" : ghost}`,
          }}
        />
        {data.study ? "Study" : "Source"}
      </div>
      <div
        style={{
          ...clamp(3),
          marginTop: 3,
          fontSize: 10,
          lineHeight: 1.4,
          color: "var(--muted-foreground)",
        }}
      >
        {data.label}
      </div>
    </div>
  );
}

export function CruxNode({ data, selected }: NodeProps<any>) {
  return (
    <div
      className="graph-node"
      data-incoming={data.incoming || undefined}
      style={{ width: 176, textAlign: "center" }}
    >
      <Handles />
      <Pill kind="crux" selected={selected} />
      <div
        style={{
          ...clamp(4),
          marginTop: 4,
          fontSize: 10.5,
          lineHeight: 1.4,
          color: "var(--foreground)",
        }}
      >
        {data.label}
      </div>
    </div>
  );
}

export function HypothesisNode({ data, selected }: NodeProps<any>) {
  const credence = data.detail?.credence as
    | { average: number; assessors: number }
    | null
    | undefined;
  return (
    <div
      className="graph-node"
      data-incoming={data.incoming || undefined}
      style={{ width: 200, textAlign: "center" }}
    >
      <Handles />
      <ChallengeFlag challenges={data.challenges} />
      <Pill kind="hypothesis" selected={selected} />
      <div
        style={{
          ...clamp(3),
          marginTop: 4,
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.4,
          color: "var(--foreground)",
        }}
      >
        {data.label}
      </div>
      {credence ? (
        <div style={{ marginTop: 5 }}>
          <div
            style={{
              height: 3,
              borderRadius: 999,
              background: "color-mix(in oklab, #f6dc7d 45%, transparent)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(credence.average * 100)}%`,
                borderRadius: 999,
                background: KIND_PILL.hypothesis.fg,
              }}
            />
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 8.5,
              color: "var(--muted-foreground)",
            }}
          >
            {Math.round(credence.average * 100)}% community credence ·{" "}
            {credence.assessors}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const nodeTypes = {
  claim: ClaimNode,
  source: SourceNode,
  crux: CruxNode,
  hypothesis: HypothesisNode,
} as NodeTypes;
