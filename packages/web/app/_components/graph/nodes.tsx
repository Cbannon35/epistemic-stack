import {
  Handle,
  type NodeProps,
  type NodeTypes,
  Position,
} from "@xyflow/react";
import type { CSSProperties } from "react";
import { positionColor } from "./types";

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

export function ClaimNode({ data, selected }: NodeProps<any>) {
  const accent = positionColor(data.position) ?? "var(--border)";
  const edge = selected ? "var(--foreground)" : "var(--border)";
  return (
    <div
      className="graph-node"
      style={{
        width: 200,
        borderRadius: 10,
        // Longhand only — mixing the `border` shorthand with `borderLeft`
        // makes React warn about conflicting style updates across rerenders.
        borderStyle: "solid",
        borderWidth: "1px 1px 1px 4px",
        borderColor: `${edge} ${edge} ${edge} ${accent}`,
        background: "var(--card)",
        color: "var(--card-foreground)",
        padding: "8px 10px",
        fontSize: 11,
        lineHeight: 1.35,
        boxShadow: selected ? "0 0 0 2px var(--foreground)" : undefined,
      }}
    >
      <Handles />
      <div style={clamp(4)}>{data.label}</div>
      {data.sources > 1 ? (
        <div
          style={{
            marginTop: 4,
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

export function SourceNode({ data, selected }: NodeProps<any>) {
  return (
    <div
      className="graph-node"
      style={{
        width: 130,
        borderRadius: 999,
        border: `1px solid ${selected ? "var(--foreground)" : "var(--border)"}`,
        background: "var(--muted)",
        color: "var(--muted-foreground)",
        padding: "5px 9px",
        fontSize: 9,
      }}
    >
      <Handles />
      <div style={clamp(2)}>{data.label}</div>
    </div>
  );
}

export function CruxNode({ data, selected }: NodeProps<any>) {
  return (
    <div
      className="graph-node"
      style={{
        width: 172,
        borderRadius: 10,
        border: `1px solid ${selected ? "#b45309" : "#d97706"}`,
        background: "color-mix(in oklab, #d97706 12%, var(--card))",
        color: "var(--foreground)",
        padding: "6px 9px",
        fontSize: 10,
        fontStyle: "italic",
      }}
    >
      <Handles />
      <div
        style={{
          fontSize: 8,
          fontStyle: "normal",
          fontWeight: 600,
          color: "#b45309",
        }}
      >
        CRUX
      </div>
      <div style={clamp(3)}>{data.label}</div>
    </div>
  );
}

export function HypothesisNode({ data, selected }: NodeProps<any>) {
  const ab = data.detail?.answer_bearing as string | undefined;
  return (
    <div
      className="graph-node"
      style={{
        width: 224,
        borderRadius: 12,
        border: `2px solid ${selected ? "#6d28d9" : "#7c3aed"}`,
        background: "color-mix(in oklab, #7c3aed 9%, var(--card))",
        color: "var(--foreground)",
        padding: "9px 11px",
        boxShadow: selected ? "0 0 0 2px #7c3aed" : undefined,
      }}
    >
      <Handles />
      <div
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "#7c3aed",
          marginBottom: 3,
        }}
      >
        Hypothesis{ab ? ` · answers "${ab}"` : ""}
      </div>
      <div
        style={{ ...clamp(3), fontSize: 12, fontWeight: 500, lineHeight: 1.35 }}
      >
        {data.label}
      </div>
    </div>
  );
}

export const nodeTypes = {
  claim: ClaimNode,
  source: SourceNode,
  crux: CruxNode,
  hypothesis: HypothesisNode,
} as NodeTypes;
