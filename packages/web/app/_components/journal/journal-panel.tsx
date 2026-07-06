"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import type {
  Journal,
  JournalAction,
  JournalDelegation,
  JournalTurn,
} from "@/lib/journal";

const EVE_VIOLET = "#7c3aed";
const PAGE = 12;

function timeAgo(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) {
    return "now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  return `${Math.floor(seconds / 86_400)}d`;
}

function EveDot() {
  return (
    <span
      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: EVE_VIOLET }}
    >
      <SparklesIcon className="size-2.5" />
    </span>
  );
}

function ActionLine({ action }: { action: JournalAction }) {
  const clickable = Boolean(action.nodeId);
  const body = (
    <span className="text-muted-foreground text-xs leading-snug">
      {action.summary}
    </span>
  );
  if (!clickable) {
    return <div className="pl-6">{body}</div>;
  }
  return (
    <button
      className="block w-full rounded px-1 py-0.5 pl-6 text-left transition-colors duration-150 hover:bg-muted/60"
      onClick={() =>
        action.nodeId && graphBus.emit("focusNode", { nodeId: action.nodeId })
      }
      type="button"
    >
      {body}
    </button>
  );
}

function TurnCard({ turn }: { turn: JournalTurn }) {
  const [showThinking, setShowThinking] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  return (
    <div className="border-border/40 border-b px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium text-sm leading-snug">
          {turn.question ?? "eve continued the investigation"}
        </p>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {timeAgo(turn.at)}
        </span>
      </div>

      {turn.thinking.length > 0 ? (
        <div className="mt-2">
          <button
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
            onClick={() => setShowThinking((v) => !v)}
            type="button"
          >
            {showThinking ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            <SparklesIcon className="size-3" style={{ color: EVE_VIOLET }} />
            eve’s reasoning
          </button>
          {showThinking ? (
            <div className="mt-1.5 space-y-1.5 border-border/50 border-l pl-3">
              {turn.thinking.map((t) => (
                <p
                  className="text-muted-foreground text-xs leading-relaxed"
                  key={t.slice(0, 48)}
                >
                  {t}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {turn.actions.length > 0 ? (
        <div className="mt-2 space-y-0.5">
          {turn.actions.map((a, i) => (
            <div className="flex items-start gap-2" key={a.id}>
              {i === 0 ? <EveDot /> : <span className="w-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                <ActionLine action={a} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {turn.answer ? (
        <div className="mt-2">
          <button
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
            onClick={() => setShowAnswer((v) => !v)}
            type="button"
          >
            {showAnswer ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            answer
          </button>
          {showAnswer ? (
            <p className="mt-1.5 whitespace-pre-wrap text-foreground/90 text-xs leading-relaxed">
              {turn.answer}
            </p>
          ) : null}
        </div>
      ) : null}

      {turn.tokens > 0 ? (
        <div className="mt-2 text-[10px] text-muted-foreground/70 tabular-nums">
          {turn.tokens.toLocaleString()} tokens
        </div>
      ) : null}
    </div>
  );
}

function DelegationCard({ delegation }: { delegation: JournalDelegation }) {
  const [open, setOpen] = useState(false);
  const counts = Object.entries(delegation.outputCounts);
  return (
    <div className="border-border/40 border-b bg-muted/20 px-4 py-3">
      <button
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <EveDot />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm leading-snug">
            Delegated investigation · {delegation.status}
          </p>
          <p className="text-muted-foreground text-xs leading-snug">
            “{delegation.brief}”
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {timeAgo(delegation.at)}
        </span>
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 border-border/50 border-l pl-3">
          {delegation.steps.map((s) => (
            <p
              className="text-muted-foreground text-xs leading-relaxed"
              key={`${s.at}-${s.kind}-${s.narration.slice(0, 24)}`}
            >
              <span className="font-medium text-foreground/70">{s.kind}:</span>{" "}
              {s.narration}
            </p>
          ))}
          {delegation.summary ? (
            <p className="pt-1 text-foreground/90 text-xs leading-relaxed">
              {delegation.summary}
            </p>
          ) : null}
          {counts.length > 0 ? (
            <p className="pt-1 text-[10px] text-muted-foreground">
              Recorded {counts.map(([k, n]) => `${n} ${k}`).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Interleave turns + delegations by timestamp so the audit trail reads in the
// order things actually happened.
type Item =
  | { kind: "turn"; at: number; turn: JournalTurn }
  | { kind: "delegation"; at: number; delegation: JournalDelegation };

function interleave(journal: Journal): Item[] {
  const items: Item[] = [];
  for (const turn of journal.turns) {
    items.push({ kind: "turn", at: new Date(turn.at ?? 0).getTime(), turn });
  }
  for (const delegation of journal.delegations) {
    items.push({
      kind: "delegation",
      at: new Date(delegation.at ?? 0).getTime(),
      delegation,
    });
  }
  return items.sort((a, b) => a.at - b.at);
}

export function JournalPanel({
  investigation,
  onClose,
}: {
  investigation: string | null;
  onClose: () => void;
}) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [error, setError] = useState(false);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!investigation) {
      return;
    }
    let cancelled = false;
    setJournal(null);
    setError(false);
    setShown(PAGE);
    fetch(`/api/journal/${encodeURIComponent(investigation)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: Journal) => {
        if (!cancelled) {
          setJournal(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [investigation]);

  const items = journal ? interleave(journal) : [];
  // Newest-first paging: keep the most recent `shown` items, oldest at top.
  const start = Math.max(0, items.length - shown);
  const visible = items.slice(start);
  const hiddenEarlier = start;

  return (
    <div className="panel-in-right absolute top-0 right-0 bottom-0 z-20 flex w-[26rem] max-w-[90%] flex-col border-border/60 border-l bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between border-border/40 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-3.5" style={{ color: EVE_VIOLET }} />
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Investigation journal
          </span>
        </div>
        <button
          aria-label="Close journal"
          className="-m-1 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error ? (
          <p className="px-4 py-6 text-muted-foreground text-sm">
            Couldn’t load the journal.
          </p>
        ) : null}
        {journal || error ? null : (
          <p className="px-4 py-6 text-muted-foreground text-sm">Loading…</p>
        )}
        {journal && items.length === 0 ? (
          <p className="px-4 py-6 text-muted-foreground text-sm">
            Nothing recorded yet — ask eve a question to begin the trail.
          </p>
        ) : null}
        {hiddenEarlier > 0 ? (
          <button
            className="w-full border-border/40 border-b px-4 py-2.5 text-center text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
            onClick={() => setShown((n) => n + PAGE)}
            type="button"
          >
            Load {Math.min(PAGE, hiddenEarlier)} earlier
          </button>
        ) : null}
        {visible.map((item) =>
          item.kind === "turn" ? (
            <TurnCard key={item.turn.turnId} turn={item.turn} />
          ) : (
            <DelegationCard
              delegation={item.delegation}
              key={item.delegation.id}
            />
          )
        )}
      </div>
    </div>
  );
}
