// Shared merge-request types (client + server) — the lib/challenge-types.ts
// pattern: lib/merge.ts ("server-only") implements against these; client
// panels import them without dragging server code into the bundle.

export type MergeStatus = "open" | "accepted" | "declined" | "withdrawn";

export type MergeRequestRecord = {
  id: string;
  sourceId: string;
  targetId: string;
  sourceTitle: string | null;
  targetTitle: string | null;
  proposerId: string;
  proposerName: string;
  note: string | null;
  status: MergeStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type MergeDiffCounts = {
  incoming: number;
  shared: number;
  targetOnly: number;
};
