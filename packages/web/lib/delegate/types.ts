// Shared client/server shapes for delegated eve investigations. The server
// phase machine (lib/delegate/run.ts) returns a batch of narration steps per
// phase; the delegating client plays them into the room (cursor + broadcasts)
// and asks for the next phase.

export type DelegationStatus = "running" | "completed" | "cancelled" | "error";

/** One narration beat the host client plays (cursor move + bubble + ring). */
export type DelegationBeat = {
  kind: "plan" | "examine" | "research" | "record" | "conclusion";
  /** Existing graph node to visit; null = stay put and narrate. */
  nodeId: string | null;
  narration: string;
};

/** What a start/step call returns: beats to play, then continue or finish. */
export type DelegationAdvance = {
  delegationId: string;
  beats: DelegationBeat[];
  done: boolean;
  summary?: string;
};

/** A logged step, as persisted on the row and served to the dock. */
export type DelegationLogEntry = {
  kind: DelegationBeat["kind"];
  narration: string;
  at: number;
};

/** Dock projection of a delegation row. */
export type DelegationSummary = {
  id: string;
  brief: string;
  /** running rows with a stale heartbeat are reported as "interrupted". */
  status: DelegationStatus | "interrupted";
  plan: string | null;
  summary: string | null;
  delegatorId: string;
  delegatorName: string;
  steps: DelegationLogEntry[];
  createdAt: string;
  updatedAt: string;
};
