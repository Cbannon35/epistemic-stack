import {
  Client,
  type ClientMessageFailedEvent,
  type ClientMessageSubmittedEvent,
  defaultMessageReducer,
  type EveAgentReducer,
  type EveAgentReducerEvent,
  type EveMessageData,
  type HandleMessageStreamEvent,
  isCurrentTurnBoundaryEvent,
  type SessionState,
} from "eve/client";
import {
  getSendState,
  recordTurnAuthor,
  saveInvestigation,
} from "@/app/(chat)/actions";
import {
  getQueuedCommentContext,
  markCommentsConsumed,
} from "@/app/(chat)/comment-actions";
import type { TurnAuthor } from "@/lib/investigations";

// Multiplayer chat store. eve's durable session stream is the single source of
// events for EVERY member — the sender's POST response stream is never
// iterated; its events arrive through the same shared reader all members run.
// That symmetry is what makes N browsers on one session trivially consistent:
// there is exactly one event log and everyone tails it.

export type RoomStatus = "ready" | "submitted" | "streaming" | "error";

export type RoomIdentity = { userId: string; displayName: string };

export type RoomAuthor = { contributorId: string; displayName: string };

export type RoomSnapshot = {
  data: EveMessageData;
  events: readonly HandleMessageStreamEvent[];
  session: { sessionId?: string };
  status: RoomStatus;
  error?: Error;
  /** The turn currently executing, and whether this client sent it. */
  activeTurn: { turnId: string; mine: boolean } | null;
  /** turnId → who sent it (seeded from DB, updated live). */
  authors: ReadonlyMap<string, RoomAuthor>;
  /** Terminal session — no further sends will be accepted. */
  completed: boolean;
};

export type RoomBus = {
  publish: (
    event: "turn:pending" | "turn:author" | "comments:changed",
    payload: Record<string, unknown>
  ) => void;
};

export type RoomStoreInit = {
  me: RoomIdentity;
  initialState?: SessionState | null;
  initialEvents?: HandleMessageStreamEvent[] | null;
  initialAuthors?: TurnAuthor[] | null;
  title?: string | null;
  forkedFrom?: string | null;
  forkSeedLoader?: () => Promise<{ title: string; seed: string } | null>;
  onSessionStart?: (sessionId: string) => void;
  onSaved?: () => void;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

let submissionSequence = 0;
function createSubmissionId(): string {
  submissionSequence += 1;
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `submission_${submissionSequence}`;
}

export class RoomStore {
  readonly #init: RoomStoreInit;
  readonly #client = new Client({ host: "" });
  readonly #reducer: EveAgentReducer<EveMessageData> = defaultMessageReducer();

  // Two logs, mirroring eve's own store: #events is the authoritative durable
  // stream; #projEvents adds synthetic client events (optimistic messages) and
  // is what the reducer projects for the UI.
  #events: HandleMessageStreamEvent[];
  #projEvents: EveAgentReducerEvent[];
  #data: EveMessageData;

  #sessionId: string | undefined;
  #seedToken: string | undefined;
  #title: string | null;
  #status: RoomStatus = "ready";
  #error: Error | undefined;
  #completed = false;
  #activeTurn: { turnId: string; mine: boolean } | null = null;
  readonly #authors = new Map<string, RoomAuthor>();

  // Optimistic user message awaiting its authoritative message.received.
  #optimistic: { id: string; text: string; createdAt: number } | null = null;
  // True between our accepted POST and that turn's message.received/boundary.
  #sentPending = false;
  // The token our in-flight turn was sent with (persisted at the boundary).
  #sentToken: string | undefined;
  // Comment threads riding our in-flight turn (one-shot context injection);
  // marked consumed once the turn is accepted.
  #pendingCommentIds: string[] = [];

  readonly #listeners = new Set<() => void>();
  #snapshot: RoomSnapshot;
  #loopAbort: AbortController | null = null;
  #nudgeWaiter: (() => void) | null = null;

  constructor(init: RoomStoreInit) {
    this.#init = init;
    this.#events = [...(init.initialEvents ?? [])];
    this.#projEvents = [...this.#events];
    this.#data = this.#reduceAll(this.#projEvents);
    this.#sessionId = init.initialState?.sessionId;
    this.#seedToken = init.initialState?.continuationToken;
    this.#title = init.title ?? null;
    for (const a of init.initialAuthors ?? []) {
      this.#authors.set(a.turnId, {
        contributorId: a.contributorId,
        displayName: a.displayName,
      });
    }
    this.#snapshot = this.#buildSnapshot();
  }

  // ── React binding ──────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      this.#startLoop();
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#stopLoop();
      }
    };
  };

  getSnapshot = (): RoomSnapshot => this.#snapshot;

  // ── room channel wiring (set by the provider once the channel exists) ─────

  #bus: RoomBus | null = null;
  setBus(bus: RoomBus | null): void {
    this.#bus = bus;
  }

  /** A member signalled a new turn — reattach the stream reader now. */
  nudge(): void {
    this.#nudgeWaiter?.();
  }

  /** Live author attribution from another member's broadcast. */
  setAuthor(turnId: string, author: RoomAuthor): void {
    if (this.#authors.has(turnId)) {
      return;
    }
    this.#authors.set(turnId, author);
    this.#emit();
  }

  // ── sending ────────────────────────────────────────────────────────────────

  send = async (input: { message: string }): Promise<void> => {
    if (this.#status !== "ready" || this.#completed) {
      return;
    }
    const text = input.message;
    this.#status = "submitted";
    this.#error = undefined;
    this.#appendOptimistic(text);
    this.#bus?.publish("turn:pending", {
      displayName: this.#init.me.displayName,
    });
    this.#emit();

    try {
      const isFirst = this.#sessionId === undefined;
      let state: SessionState;
      let forkSeed: string | undefined;
      let pinnedComments: string | undefined;
      if (isFirst) {
        state = { streamIndex: 0 };
        forkSeed = (await this.#init.forkSeedLoader?.())?.seed;
      } else {
        const sessionId = this.#sessionId as string;
        const [persisted, queued] = await Promise.all([
          getSendState(sessionId) as Promise<SessionState | null>,
          // One-shot comment context: checkmarked threads ride THIS turn,
          // then flip to "consumed" once it's accepted.
          getQueuedCommentContext(sessionId),
        ]);
        const continuationToken =
          persisted?.continuationToken ?? this.#seedToken;
        if (!continuationToken) {
          throw new Error("This investigation can't accept new messages.");
        }
        state = { sessionId, continuationToken, streamIndex: 0 };
        if (queued) {
          pinnedComments = queued.digest;
          this.#pendingCommentIds = queued.ids;
        }
      }

      const clientContext: Record<string, string> = {
        author: this.#init.me.displayName,
      };
      if (forkSeed) {
        clientContext.forkedFromContext = forkSeed;
      }
      if (pinnedComments) {
        clientContext.pinnedComments = pinnedComments;
      }

      const session = this.#client.session(state);
      const res = await session.send({ message: text, clientContext });
      // Fire-and-forget: the shared durable stream is the single event source;
      // the POST's response stream is deliberately never iterated.
      this.#sentPending = true;
      this.#sentToken = state.continuationToken ?? res.continuationToken;

      if (isFirst) {
        this.#sessionId = res.sessionId;
        this.#seedToken = res.continuationToken;
        this.#title = this.#title ?? text;
        // Persist the token immediately: the room stays joinable and sendable
        // by others even if this tab dies mid-turn.
        await saveInvestigation({
          sessionId: res.sessionId,
          title: this.#title ?? text,
          sessionState: {
            sessionId: res.sessionId,
            continuationToken: res.continuationToken,
            streamIndex: 0,
          },
          events: [],
          forkedFrom: this.#init.forkedFrom ?? null,
        });
        this.#init.onSessionStart?.(res.sessionId);
        this.#init.onSaved?.();
        this.#startLoop();
      } else {
        // The reader may be parked between turns — wake it right away.
        this.nudge();
      }
    } catch (err) {
      this.#failOptimistic(toError(err));
      this.#status = "error";
      this.#error = toError(err);
      this.#sentPending = false;
      this.#pendingCommentIds = [];
      this.#emit();
    }
  };

  stop = (): void => {
    // A running turn is shared, durable, server-side work — it can't be
    // cancelled from one member's tab. Only a not-yet-accepted submit could
    // be, and that window is milliseconds; keep this a no-op for clarity.
  };

  // ── the shared stream reader ──────────────────────────────────────────────

  #startLoop(): void {
    if (this.#loopAbort || !this.#sessionId) {
      return;
    }
    const abort = new AbortController();
    this.#loopAbort = abort;
    this.#runLoop(abort).catch(() => {
      // The loop handles its own errors; this only guards against bugs.
    });
  }

  #stopLoop(): void {
    this.#loopAbort?.abort();
    this.#loopAbort = null;
    this.#nudgeWaiter?.();
  }

  async #runLoop(abort: AbortController): Promise<void> {
    while (!abort.signal.aborted) {
      const sessionId = this.#sessionId;
      if (!sessionId) {
        return;
      }
      try {
        // Fresh read-only handle per attach. The local event count IS the
        // cursor — the persisted streamIndex is never trusted.
        const reader = this.#client.session({
          sessionId,
          streamIndex: this.#events.length,
        });
        for await (const event of reader.stream({
          startIndex: this.#events.length,
          signal: abort.signal,
        })) {
          if (abort.signal.aborted) {
            return;
          }
          this.#ingest(event);
        }
      } catch {
        // Aborted or transport error past the built-in reconnects; fall
        // through to the park-and-reattach wait either way.
      }
      if (abort.signal.aborted) {
        return;
      }
      // Server EOF between turns (or reconnect budget spent): park until a
      // member nudges (turn:pending broadcast / own send) or the timer fires.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.#nudgeWaiter = null;
          resolve();
        }, 15_000);
        this.#nudgeWaiter = () => {
          clearTimeout(timer);
          this.#nudgeWaiter = null;
          resolve();
        };
      });
    }
  }

  // ── ingest ─────────────────────────────────────────────────────────────────

  #ingest(event: HandleMessageStreamEvent): void {
    this.#events = [...this.#events, event];

    if (
      event.type === "message.received" &&
      this.#optimistic &&
      event.data.message === this.#optimistic.text
    ) {
      // Our optimistic message got confirmed: swap the synthetic projection
      // event for the authoritative one and claim authorship of the turn.
      const optimisticId = this.#optimistic.id;
      this.#optimistic = null;
      this.#replaceProjection(
        (e) =>
          e.type === "client.message.submitted" &&
          e.data.submissionId === optimisticId,
        event
      );
      if (this.#sentPending && this.#sessionId) {
        const author: RoomAuthor = {
          contributorId: this.#init.me.userId,
          displayName: this.#init.me.displayName,
        };
        this.#authors.set(event.data.turnId, author);
        this.#bus?.publish("turn:author", {
          turnId: event.data.turnId,
          ...author,
        });
        recordTurnAuthor({
          sessionId: this.#sessionId,
          turnId: event.data.turnId,
        }).catch(() => {
          // Attribution is best-effort; the broadcast already told peers.
        });
        if (this.#pendingCommentIds.length > 0) {
          const ids = this.#pendingCommentIds;
          this.#pendingCommentIds = [];
          markCommentsConsumed({ ids, turnId: event.data.turnId })
            .then(() => {
              this.#bus?.publish("comments:changed", {
                sessionId: this.#sessionId,
              });
            })
            .catch(() => {
              // Threads stay queued and ride the next turn instead.
            });
        }
      }
    } else {
      this.#appendProjection(event);
    }

    if (event.type === "turn.started") {
      this.#activeTurn = {
        turnId: event.data.turnId,
        mine: this.#sentPending,
      };
      this.#status = "streaming";
    }

    if (isCurrentTurnBoundaryEvent(event)) {
      this.#activeTurn = null;
      if (event.type === "session.failed") {
        this.#status = "error";
        const err = new Error(event.data.message);
        err.name = event.data.code;
        this.#error = err;
      } else {
        this.#status = "ready";
      }
      if (event.type === "session.completed") {
        this.#completed = true;
      }
      if (this.#sentPending) {
        this.#sentPending = false;
        this.#persistSnapshot().catch(() => {
          // Next turn's sender re-snapshots; the durable stream has the truth.
        });
      }
    }

    this.#emit();
  }

  // Only the turn sender writes the boundary snapshot: it fetched the token at
  // send time, so it can never persist a stale one. Followers never write.
  async #persistSnapshot(): Promise<void> {
    const sessionId = this.#sessionId;
    if (!sessionId) {
      return;
    }
    await saveInvestigation({
      sessionId,
      title: this.#title ?? "Investigation",
      sessionState: {
        sessionId,
        continuationToken: this.#sentToken ?? this.#seedToken,
        streamIndex: this.#events.length,
      },
      events: this.#events,
      forkedFrom: this.#init.forkedFrom ?? null,
    });
    this.#init.onSaved?.();
  }

  // ── projection helpers (mirroring eve's EveAgentStore) ────────────────────

  #appendOptimistic(text: string): void {
    const optimistic = {
      id: createSubmissionId(),
      text,
      createdAt: Date.now(),
    };
    this.#optimistic = optimistic;
    const event: ClientMessageSubmittedEvent = {
      type: "client.message.submitted",
      data: {
        createdAt: optimistic.createdAt,
        message: text,
        submissionId: optimistic.id,
      },
    };
    this.#appendProjection(event);
  }

  #failOptimistic(error: Error): void {
    const optimistic = this.#optimistic;
    if (!optimistic) {
      return;
    }
    this.#optimistic = null;
    const event: ClientMessageFailedEvent = {
      type: "client.message.failed",
      data: {
        createdAt: optimistic.createdAt,
        error: { message: error.message },
        message: optimistic.text,
        submissionId: optimistic.id,
      },
    };
    this.#replaceProjection(
      (e) =>
        e.type === "client.message.submitted" &&
        e.data.submissionId === optimistic.id,
      event
    );
  }

  #appendProjection(event: EveAgentReducerEvent): void {
    this.#projEvents = [...this.#projEvents, event];
    this.#data = this.#reducer.reduce(this.#data, event);
  }

  #replaceProjection(
    predicate: (e: EveAgentReducerEvent) => boolean,
    replacement: EveAgentReducerEvent
  ): void {
    let replaced = false;
    this.#projEvents = this.#projEvents.map((e) => {
      if (!replaced && predicate(e)) {
        replaced = true;
        return replacement;
      }
      return e;
    });
    if (!replaced) {
      this.#projEvents = [...this.#projEvents, replacement];
    }
    this.#data = this.#reduceAll(this.#projEvents);
  }

  #reduceAll(events: readonly EveAgentReducerEvent[]): EveMessageData {
    let data = this.#reducer.initial();
    for (const event of events) {
      data = this.#reducer.reduce(data, event);
    }
    return data;
  }

  // ── snapshot fan-out ───────────────────────────────────────────────────────

  #buildSnapshot(): RoomSnapshot {
    return {
      data: this.#data,
      events: this.#events,
      session: { sessionId: this.#sessionId },
      status: this.#status,
      error: this.#error,
      activeTurn: this.#activeTurn,
      authors: new Map(this.#authors),
      completed: this.#completed,
    };
  }

  #emit(): void {
    this.#snapshot = this.#buildSnapshot();
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
