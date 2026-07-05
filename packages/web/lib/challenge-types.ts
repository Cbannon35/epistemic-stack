// Client-safe challenge vocabulary — shared by server queries and UI.
// A challenge is an append-only `assessment` (kind = 'challenge'); nothing is
// ever deleted, so a node's dispute status is DERIVED from the record:
// undisputed → contested (an open challenge) → answered (every challenge has
// a response from someone other than the challenger).

export type ChallengeTargetKind =
  | "claim"
  | "source"
  | "hypothesis"
  | "relation";

export type ChallengeType =
  | "counter_evidence"
  | "rival_interpretation"
  | "methodological_objection";

export const CHALLENGE_TYPES: readonly ChallengeType[] = [
  "counter_evidence",
  "rival_interpretation",
  "methodological_objection",
];

export const CHALLENGE_TYPE_LABELS: Record<ChallengeType, string> = {
  counter_evidence: "counter-evidence",
  rival_interpretation: "rival interpretation",
  methodological_objection: "methodological objection",
};

export type ChallengeState = "undisputed" | "contested" | "answered";

/** Per-node rollup for graph badges and chat claim cards. */
export type NodeChallengeSummary = {
  /** Challenges still awaiting a response from someone else. */
  open: number;
  /** All challenges ever filed against the node. */
  total: number;
  /** Every dispute entry (challenges + responses) — reload-signature fodder. */
  entries: number;
  state: Exclude<ChallengeState, "undisputed">;
};

export type ChallengeEntry = {
  id: string;
  authorId: string;
  authorName: string;
  authorKind: string;
  challengeType: ChallengeType | null;
  body: string;
  evidenceUrl: string | null;
  createdAt: string;
};

export type ChallengeThread = {
  challenge: ChallengeEntry;
  responses: ChallengeEntry[];
};

/** One provenance link in a node's chain of custody. */
export type ReceiptRecord = {
  contributionId: string;
  method: string;
  payloadHash: string;
  signed: boolean;
  createdAt: string;
  contributor: { id: string; name: string; kind: string };
  investigation: { id: string; title: string } | null;
  /** Display name of the person whose turn produced this write, when known. */
  askedBy: string | null;
};

export type NodeReceipts = {
  nodeId: string;
  kind: "claim" | "source" | "hypothesis" | "crux";
  label: string;
  created: ReceiptRecord | null;
  /** Claims only: the extraction receipt behind each source mention. */
  mentions: Array<{
    quote: string;
    sourceId: string;
    sourceTitle: string | null;
    sourceUrl: string | null;
    receipt: ReceiptRecord | null;
  }>;
  threads: ChallengeThread[];
  state: ChallengeState;
};
