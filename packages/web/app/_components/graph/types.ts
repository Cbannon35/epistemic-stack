// Shared types for the claim-graph panel.

export type NodeKind = "claim" | "source" | "crux" | "hypothesis";

export type Mention = { sourceId: string; quote: string };

export type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  sources?: number;
  position?: string | null;
  detail?: Record<string, unknown> & { mentions?: Mention[] };
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  diagnosticity?: number | null;
};

export type GraphCounts = {
  claims: number;
  sources: number;
  relations: number;
  cruxes: number;
  hypotheses: number;
};

export type HypothesisAssessment = {
  id: string;
  statement: string;
  answerBearing: string | null;
  support: number;
  undermine: number;
  claimCount: number;
};

export type Assessment = {
  hypotheses: HypothesisAssessment[];
  openCruxes: number;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  counts: GraphCounts;
  assessment?: Assessment;
};

// Position → hue for claim tinting. Falls back to neutral for untagged/unknown.
export function positionColor(position?: string | null): string | null {
  if (!position) {
    return null;
  }
  const p = position.toLowerCase();
  if (/pro|support|for|yes|lab|leak/.test(p)) {
    return "#2563eb"; // blue-ish "pro" pole
  }
  if (/anti|against|no|zoong|zoono|natural|spillover/.test(p)) {
    return "#0d9488"; // teal "con" pole
  }
  return "#8b5cf6"; // other stance
}

export const EDGE_STYLE: Record<
  string,
  { stroke: string; dash?: string; label?: string }
> = {
  supports: { stroke: "#16a34a", label: "supports" },
  contradicts: { stroke: "#dc2626", label: "contradicts" },
  depends_on: { stroke: "#6b7280", dash: "4 4", label: "depends on" },
  refines: { stroke: "#2563eb", label: "refines" },
  mention: { stroke: "#cbd5e1" },
  crux: { stroke: "#d97706", dash: "2 3" },
  hyp_supports: { stroke: "#16a34a", dash: "6 3" },
  hyp_undermines: { stroke: "#dc2626", dash: "6 3" },
};
