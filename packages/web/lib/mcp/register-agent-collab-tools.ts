import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "eve/client";
import { z } from "zod";
import { getComment, insertComment } from "@/lib/comments";
import { FRESH_START_POLICY } from "@/lib/commons-policy";
import { buildCommonsSeed } from "@/lib/commons-search";
import { startDelegation, stepDelegation } from "@/lib/delegate/run";
import type { DelegationAdvance } from "@/lib/delegate/types";
import {
  claimEveSession,
  getInvestigation,
  insertTurnAuthor,
} from "@/lib/investigations";
import { buildJournal } from "@/lib/journal";
import {
  type AgentScope,
  announce as announceShared,
  asText,
  unknownInvestigation,
} from "@/lib/mcp/shared";
import {
  broadcastRoomEvent,
  broadcastRoomEvents,
} from "@/lib/realtime/server-broadcast";
import type {
  CommentsChangedEvent,
  DelegationEndEvent,
  DelegationStartEvent,
  DelegationStepEvent,
} from "@/lib/realtime/types";

// Collaboration parity for external agents: the tools that make an MCP agent
// a room MEMBER rather than a graph feed — reading the transcript, chatting
// through real eve turns, commenting, and delegating eve sub-investigations.
// Same trust model as the write tools: everything runs under the agent's own
// contributor identity; rooms hear about it via server-side broadcasts.

const TURN_ACCEPT_TIMEOUT_MS = 25_000;
const REPLY_WAIT_BUDGET_MS = 30_000;
const REPLY_CLIP = 4000;

export type AgentCollabScope = AgentScope;

// Collaboration actions live in the CHAT pane by default.
const announce = (
  scope: AgentCollabScope,
  investigationId: string,
  action: string,
  view: "chat" | "graph" = "chat"
) => announceShared(scope, investigationId, action, { view });

// ── transcript ───────────────────────────────────────────────────────────────

function registerTranscript(server: McpServer): void {
  server.registerTool(
    "get_transcript",
    {
      title: "Read a room's chat transcript",
      description:
        "The investigation's chat so far: each turn's question, eve's answer, and the message ids (`<turnId>:user` / `<turnId>:assistant`) that comment anchors use.",
      inputSchema: { investigation_id: z.string().min(1) },
    },
    async ({ investigation_id }) => {
      const journal = await buildJournal(investigation_id);
      if (!journal) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      return asText({
        title: journal.title,
        turns: journal.turns.map((t) => ({
          turnId: t.turnId,
          at: t.at,
          question: t.question,
          questionMessageId: `${t.turnId}:user`,
          answer: t.answer,
          answerMessageId: `${t.turnId}:assistant`,
          actions: t.actions.map((a) => a.summary),
        })),
        note: "The transcript snapshot lags live turns by a save cycle; the graph is always current.",
      });
    }
  );
}

// ── comments ─────────────────────────────────────────────────────────────────

function commentsChanged(
  scope: AgentCollabScope,
  sessionId: string,
  action: "commented" | "replied",
  quote?: string | null
): void {
  const payload: CommentsChangedEvent = {
    sessionId,
    actorId: scope.agent.contributorId,
    actorName: scope.agent.name,
    action,
    quote: quote ?? undefined,
  };
  broadcastRoomEvent(sessionId, "comments:changed", payload).catch(
    () => undefined
  );
}

function registerComments(server: McpServer, scope: AgentCollabScope): void {
  server.registerTool(
    "add_comment",
    {
      title: "Comment on a chat message",
      description:
        "Start a public comment thread in a room. Anchor it to a message by quoting a verbatim passage from that message (see get_transcript for message ids); prefix/suffix disambiguate repeated text.",
      inputSchema: {
        investigation_id: z.string().min(1),
        body: z.string().min(1).max(2000),
        message_id: z
          .string()
          .min(1)
          .describe("`<turnId>:user` or `<turnId>:assistant`"),
        quote: z
          .string()
          .min(1)
          .describe("verbatim passage from that message to highlight"),
        quote_prefix: z.string().optional(),
        quote_suffix: z.string().optional(),
      },
    },
    async ({
      investigation_id,
      body,
      message_id,
      quote,
      quote_prefix,
      quote_suffix,
    }) => {
      const missing = await unknownInvestigation(investigation_id);
      if (missing) {
        return missing;
      }
      const id = await insertComment({
        sessionId: investigation_id,
        authorId: scope.agent.contributorId,
        body,
        visibility: "public",
        anchor: {
          messageId: message_id,
          quote,
          quotePrefix: quote_prefix ?? "",
          quoteSuffix: quote_suffix ?? "",
        },
      });
      commentsChanged(scope, investigation_id, "commented", quote);
      announce(scope, investigation_id, "commented on the chat");
      return asText({ comment_id: id });
    }
  );
  server.registerTool(
    "reply_to_comment",
    {
      title: "Reply in a comment thread",
      description:
        "Append a reply to an existing comment thread (pass the root or any reply's id; threads are one level deep).",
      inputSchema: {
        comment_id: z.string().min(1),
        body: z.string().min(1).max(2000),
      },
    },
    async ({ comment_id, body }) => {
      const target = await getComment(comment_id);
      if (target?.visibility !== "public") {
        return asText({ error: "unknown comment" });
      }
      const rootId = target.parentId ?? target.id;
      const id = await insertComment({
        sessionId: target.sessionId,
        authorId: scope.agent.contributorId,
        body,
        visibility: "public",
        parentId: rootId,
      });
      commentsChanged(scope, target.sessionId, "replied");
      announce(scope, target.sessionId, "replied in a comment thread");
      return asText({ comment_id: id });
    }
  );
}

// ── chat (real eve turns) ────────────────────────────────────────────────────

type PersistedState = {
  sessionId?: string;
  continuationToken?: string;
} | null;

type StreamEvent = {
  type: string;
  data?: { turnId?: string; message?: string | null; finishReason?: string };
};

// Time-boxed pull from the send's own event stream. The deadline must fire
// even when the stream goes silent (a thinking model emits nothing for long
// stretches), so each pull races the iterator against the remaining budget.
// Abandoning the stream does not cancel the turn — runs are durable
// server-side; members converge via the shared durable stream regardless.
type TurnEventPull = { timedOut?: true; done?: boolean; event?: StreamEvent };

function pullWithin(
  it: AsyncIterator<unknown>,
  ms: number
): Promise<TurnEventPull> {
  if (ms <= 0) {
    return Promise.resolve({ timedOut: true });
  }
  return Promise.race([
    it
      .next()
      .then((r) =>
        r.done ? { done: true } : { event: r.value as StreamEvent }
      ),
    new Promise<TurnEventPull>((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), ms)
    ),
  ]);
}

/** Phase 1: wait for OUR turn to be accepted. The response stream replays
 * the session log from the start, so earlier turns' events ride along —
 * the turn is identified by text-matching its `message.received`, exactly
 * how the browser matches its optimistic message. */
async function awaitAcceptance(
  it: AsyncIterator<unknown>,
  message: string
): Promise<string | null> {
  const deadline = Date.now() + TURN_ACCEPT_TIMEOUT_MS;
  for (;;) {
    const pull = await pullWithin(it, deadline - Date.now());
    if (pull.timedOut || pull.done) {
      return null;
    }
    const event = pull.event;
    if (
      event?.type === "message.received" &&
      event.data?.message === message &&
      event.data.turnId
    ) {
      return event.data.turnId;
    }
  }
}

/** Phase 2 (optional): keep reading for eve's final answer TO OUR TURN,
 * bounded well under the MCP client's request timeout. */
async function awaitReply(
  it: AsyncIterator<unknown>,
  turnId: string
): Promise<string | null> {
  let reply: string | null = null;
  const deadline = Date.now() + REPLY_WAIT_BUDGET_MS;
  for (;;) {
    const pull = await pullWithin(it, deadline - Date.now());
    if (pull.timedOut || pull.done || !pull.event) {
      return reply;
    }
    const event = pull.event;
    if (event.data?.turnId !== turnId) {
      continue;
    }
    if (
      event.type === "message.completed" &&
      event.data?.message &&
      event.data.finishReason !== "tool-calls"
    ) {
      reply = event.data.message;
    }
    if (event.type === "turn.completed" || event.type === "turn.failed") {
      return reply;
    }
  }
}

function registerSendMessage(server: McpServer, scope: AgentCollabScope): void {
  server.registerTool(
    "send_message",
    {
      title: "Send a chat message to a room",
      description:
        "Take a real turn in the investigation's chat, as this agent: the message lands in every member's transcript under your name, and eve answers it. First message in an agent-created room starts its eve session. Sends race if a turn is mid-flight — retry on failure. Set wait_for_reply to collect eve's answer (slower).",
      inputSchema: {
        investigation_id: z.string().min(1),
        message: z.string().min(1).max(4000),
        wait_for_reply: z.boolean().optional(),
      },
    },
    async ({ investigation_id, message, wait_for_reply }) => {
      const inv = await getInvestigation(investigation_id);
      if (!inv) {
        return asText({ error: `unknown investigation ${investigation_id}` });
      }
      const persisted = inv.sessionState as PersistedState;
      const token = persisted?.continuationToken;
      const eveSessionId = persisted?.sessionId ?? inv.eveSessionId;
      if (eveSessionId && !token) {
        return asText({
          error: "this investigation can't accept new messages",
        });
      }

      // Same clientContext assembly the browser composer does, minus the
      // human-only pieces (queued comment context rides human sends).
      const clientContext: Record<string, string> = {
        author: scope.agent.name,
      };
      if (inv.seedFromCommons) {
        const digest = await buildCommonsSeed(message, investigation_id);
        if (digest) {
          clientContext.commonsContext = digest;
        }
      } else {
        clientContext.commonsPolicy = FRESH_START_POLICY;
      }

      broadcastRoomEvent(investigation_id, "turn:pending", {
        displayName: scope.agent.name,
      }).catch(() => undefined);

      const client = new Client({ host: scope.origin });
      const isFirst = !eveSessionId;
      const session = client.session(
        isFirst
          ? { streamIndex: 0 }
          : {
              sessionId: eveSessionId as string,
              continuationToken: token as string,
              streamIndex: 0,
            }
      );
      const res = await session.send({ message, clientContext });

      if (isFirst) {
        const claimed = await claimEveSession({
          id: investigation_id,
          eveSessionId: res.sessionId,
          sessionState: {
            sessionId: res.sessionId,
            continuationToken: res.continuationToken,
            streamIndex: 0,
          },
          events: inv.events ?? [],
        });
        if (!claimed) {
          return asText({
            error:
              "another member initialized this room's session concurrently — retry the send",
          });
        }
      }

      // Attribution happens the moment the turn is accepted — before any
      // reply-waiting — so a client abort mid-wait can't orphan authorship.
      const it = (res as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      const turnId = await awaitAcceptance(it, message);
      if (turnId) {
        await insertTurnAuthor({
          sessionId: investigation_id,
          turnId,
          contributorId: scope.agent.contributorId,
        });
        broadcastRoomEvent(investigation_id, "turn:author", {
          turnId,
          contributorId: scope.agent.contributorId,
          displayName: scope.agent.name,
        }).catch(() => undefined);
      }
      const reply =
        (wait_for_reply ?? false) && turnId
          ? await awaitReply(it, turnId)
          : null;
      it.return?.(undefined);
      announce(
        scope,
        investigation_id,
        `asked in chat: “${message.slice(0, 80)}”`
      );
      return asText({
        ok: true,
        turn_id: turnId,
        queued: turnId === null ? true : undefined,
        eve_reply: reply ? reply.slice(0, REPLY_CLIP) : null,
        note: reply
          ? undefined
          : turnId
            ? "The turn is running; members see it stream live. Use get_transcript later for the answer."
            : "The message was accepted but is queued behind earlier turns; it will run in order. Author attribution requires the turn to start within the wait window.",
      });
    }
  );
}

// ── delegated investigations ────────────────────────────────────────────────

function agentHostId(scope: AgentCollabScope): string {
  return `agent:${scope.agent.contributorId}`;
}

/** Play an advance's beats into the room the way a delegator's browser does —
 * start/step/end broadcasts drive the fuchsia eve cursor for every member. */
async function broadcastAdvance(
  scope: AgentCollabScope,
  investigationId: string,
  advance: DelegationAdvance,
  opts: { started?: string }
): Promise<void> {
  const hostId = agentHostId(scope);
  const ts = Date.now();
  const messages: Parameters<typeof broadcastRoomEvents>[1][number][] = [];
  if (opts.started) {
    const start: DelegationStartEvent = {
      delegationId: advance.delegationId,
      hostId,
      hostName: `${scope.agent.name} → eve`,
      brief: opts.started,
      ts,
    };
    messages.push({ event: "delegation-start", payload: start });
  }
  for (const [i, beat] of advance.beats.entries()) {
    const step: DelegationStepEvent = {
      delegationId: advance.delegationId,
      hostId,
      kind: beat.kind,
      index: i,
      total: advance.beats.length,
      nodeId: beat.nodeId,
      narration: beat.narration,
      x: 0,
      y: 0,
      ts,
    };
    messages.push({ event: "delegation-step", payload: step });
  }
  if (advance.done) {
    const end: DelegationEndEvent = {
      delegationId: advance.delegationId,
      hostId,
      reason: "complete",
      summary: advance.summary,
      ts,
    };
    messages.push({ event: "delegation-end", payload: end });
  }
  // One POST for the whole burst — the endpoint takes a messages array.
  await broadcastRoomEvents(investigationId, messages);
}

function registerDelegation(server: McpServer, scope: AgentCollabScope): void {
  server.registerTool(
    "delegate_investigation",
    {
      title: "Delegate a background eve investigation",
      description:
        "Assign eve a bounded background sub-investigation in a room (the cursor-chat “@eve investigate” flow). Returns the plan's first narration beats; keep calling delegate_step until done — each call advances one phase.",
      inputSchema: {
        investigation_id: z.string().min(1),
        brief: z.string().min(3).max(500),
      },
    },
    async ({ investigation_id, brief }) => {
      const advance = await startDelegation({
        sessionId: investigation_id,
        delegatorId: scope.agent.contributorId,
        brief,
      });
      await broadcastAdvance(scope, investigation_id, advance, {
        started: brief,
      });
      announce(
        scope,
        investigation_id,
        `delegated to eve: “${brief}”`,
        "graph"
      );
      return asText({
        delegation_id: advance.delegationId,
        beats: advance.beats,
        done: advance.done,
        summary: advance.summary ?? null,
      });
    }
  );
  server.registerTool(
    "delegate_step",
    {
      title: "Advance a delegated investigation",
      description:
        "Run the next phase of a delegation you started (research → synthesize). At most one model call per step; stop when done=true.",
      inputSchema: {
        investigation_id: z.string().min(1),
        delegation_id: z.string().min(1),
      },
    },
    async ({ investigation_id, delegation_id }) => {
      const advance = await stepDelegation({
        delegationId: delegation_id,
        delegatorId: scope.agent.contributorId,
      });
      await broadcastAdvance(scope, investigation_id, advance, {});
      return asText({
        delegation_id: advance.delegationId,
        beats: advance.beats,
        done: advance.done,
        summary: advance.summary ?? null,
      });
    }
  );
}

export function registerAgentCollabTools(
  server: McpServer,
  scope: AgentCollabScope
): void {
  registerTranscript(server);
  registerComments(server, scope);
  registerSendMessage(server, scope);
  registerDelegation(server, scope);
}
