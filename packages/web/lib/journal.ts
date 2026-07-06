import "server-only";
import { createDb, schema } from "@epistack/db";
import { eq } from "drizzle-orm";

// Reader for the full investigation trail — every question, every step of
// eve's reasoning, every tool call, every answer, plus delegated runs. All of
// it already lives in `investigations.events` (the durable eve session
// snapshot) and the `delegations` table; this just narrates it. Read-only.

const db = createDb();

type RawEvent = {
  type: string;
  data?: Record<string, unknown>;
  meta?: { at?: string };
};

export type JournalAction = {
  tool: string;
  at: string | null;
  summary: string;
  /** Graph node this action produced, for click-to-focus (if any). */
  nodeId?: string;
};

export type JournalTurn = {
  turnId: string;
  at: string | null;
  question: string | null;
  /** eve's pre-tool narration across steps — the "thinking". */
  thinking: string[];
  actions: JournalAction[];
  answer: string | null;
  tokens: number;
};

export type JournalDelegation = {
  id: string;
  at: string | null;
  brief: string;
  status: string;
  summary: string | null;
  steps: Array<{ at: string | null; kind: string; narration: string }>;
  outputCounts: Record<string, number>;
};

export type Journal = {
  title: string | null;
  turns: JournalTurn[];
  delegations: JournalDelegation[];
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;

// A single tool call → one human-readable journal line (+ the graph node it
// produced, when the result carries an id we can focus).
function describeAction(
  toolName: string,
  input: Record<string, unknown>,
  output: Record<string, unknown> | undefined
): { summary: string; nodeId?: string } {
  const isNew = output?.is_new;
  const merged = isNew === false ? " · merged with existing" : "";
  switch (toolName) {
    case "record_claim": {
      const claim = str(input.claim) ?? "a claim";
      const id = str(output?.claim_id);
      return {
        summary: `Recorded claim “${truncate(claim, 90)}”${merged}`,
        nodeId: id,
      };
    }
    case "record_source": {
      const label = str(input.title) ?? str(input.url) ?? "a source";
      const id = str(output?.source_id);
      return {
        summary: `Recorded source ${truncate(label, 80)}${merged}`,
        nodeId: id,
      };
    }
    case "record_relation": {
      const type = str(input.type) ?? "relates";
      return { summary: `Linked two claims (${type})` };
    }
    case "record_crux": {
      const q = str(input.question) ?? str(input.crux) ?? "a crux";
      const id = str(output?.crux_id);
      return {
        summary: `Recorded crux “${truncate(q, 90)}”`,
        nodeId: id ? `crux:${id}` : undefined,
      };
    }
    case "record_hypothesis": {
      const s = str(input.statement) ?? "a hypothesis";
      const id = str(output?.hypothesis_id);
      return {
        summary: `Recorded hypothesis “${truncate(s, 90)}”`,
        nodeId: id ? `hyp:${id}` : undefined,
      };
    }
    case "link_claim_to_hypothesis":
      return { summary: "Linked a claim to a hypothesis" };
    case "search_web": {
      const q = str(input.query) ?? "";
      const n = Array.isArray(output?.results) ? output.results.length : null;
      return {
        summary: `Searched the web for “${truncate(q, 70)}”${n === null ? "" : ` · ${n} results`}`,
      };
    }
    case "search_sources": {
      const q = str(input.query) ?? "";
      return { summary: `Searched sources for “${truncate(q, 70)}”` };
    }
    case "query_commons": {
      const q = str(input.query) ?? "";
      const n = Array.isArray(output?.matches) ? output.matches.length : null;
      return {
        summary: `Queried the commons for “${truncate(q, 70)}”${n === null ? "" : ` · ${n} matches`}`,
      };
    }
    default:
      return { summary: toolName.replace(/_/g, " ") };
  }
}

function buildTurns(events: RawEvent[]): JournalTurn[] {
  const order: string[] = [];
  const byTurn = new Map<string, JournalTurn>();
  const toolByCall = new Map<
    string,
    { tool: string; input: Record<string, unknown> }
  >();

  const ensure = (turnId: string, at?: string): JournalTurn => {
    let turn = byTurn.get(turnId);
    if (!turn) {
      turn = {
        turnId,
        at: at ?? null,
        question: null,
        thinking: [],
        actions: [],
        answer: null,
        tokens: 0,
      };
      byTurn.set(turnId, turn);
      order.push(turnId);
    }
    return turn;
  };

  for (const ev of events) {
    const turnId = str(ev.data?.turnId);
    if (!turnId) {
      continue;
    }
    const at = ev.meta?.at;
    const turn = ensure(turnId, at);
    switch (ev.type) {
      case "message.received":
        turn.question = str(ev.data?.message) ?? turn.question;
        break;
      case "message.completed": {
        const text = str(ev.data?.message);
        if (!text) {
          break;
        }
        if (ev.data?.finishReason === "tool-calls") {
          turn.thinking.push(text);
        } else {
          turn.answer = text;
        }
        break;
      }
      case "actions.requested": {
        const actions = Array.isArray(ev.data?.actions) ? ev.data.actions : [];
        for (const a of actions as Record<string, unknown>[]) {
          const callId = str(a.callId);
          const toolName = str(a.toolName) ?? "action";
          const input = (a.input ?? {}) as Record<string, unknown>;
          if (callId) {
            toolByCall.set(callId, { tool: toolName, input });
          }
        }
        break;
      }
      case "action.result": {
        const result = (ev.data?.result ?? {}) as Record<string, unknown>;
        const callId = str(result.callId);
        const call = callId ? toolByCall.get(callId) : undefined;
        if (!call) {
          break;
        }
        const output = (result.output ?? {}) as Record<string, unknown>;
        const { summary, nodeId } = describeAction(
          call.tool,
          call.input,
          output
        );
        turn.actions.push({ tool: call.tool, at: at ?? null, summary, nodeId });
        break;
      }
      case "step.completed": {
        const usage = ev.data?.usage as { outputTokens?: number } | undefined;
        turn.tokens += usage?.outputTokens ?? 0;
        break;
      }
      default:
        break;
    }
  }

  return order.map((id) => byTurn.get(id) as JournalTurn);
}

export async function buildJournal(sessionId: string): Promise<Journal | null> {
  const [inv] = await db
    .select({
      title: schema.investigations.title,
      events: schema.investigations.events,
    })
    .from(schema.investigations)
    .where(eq(schema.investigations.id, sessionId))
    .limit(1);
  if (!inv) {
    return null;
  }

  const events = (Array.isArray(inv.events) ? inv.events : []) as RawEvent[];
  const turns = buildTurns(events);

  const delegationRows = await db
    .select()
    .from(schema.delegations)
    .where(eq(schema.delegations.sessionId, sessionId));

  const delegations: JournalDelegation[] = delegationRows.map((d) => {
    const steps = (Array.isArray(d.steps) ? d.steps : []) as Array<{
      at?: number;
      kind?: string;
      narration?: string;
    }>;
    const output = (d.output ?? {}) as Record<string, unknown>;
    const outputCounts: Record<string, number> = {};
    for (const [key, val] of Object.entries(output)) {
      if (Array.isArray(val) && val.length > 0) {
        outputCounts[key] = val.length;
      }
    }
    return {
      id: d.id,
      at: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      brief: d.brief,
      status: d.status,
      summary: d.summary ?? null,
      steps: steps.map((s) => ({
        at: typeof s.at === "number" ? new Date(s.at).toISOString() : null,
        kind: s.kind ?? "step",
        narration: s.narration ?? "",
      })),
      outputCounts,
    };
  });

  return { title: inv.title ?? null, turns, delegations };
}
