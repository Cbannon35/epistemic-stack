"use client";

import {
  BotIcon,
  ExternalLinkIcon,
  FingerprintIcon,
  FlagIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRoom } from "@/app/_components/room-provider";
import {
  fileNodeChallenge,
  getNodeReceiptsAction,
  respondToChallengeAction,
} from "@/app/(chat)/challenge-actions";
import {
  CHALLENGE_TYPE_LABELS,
  CHALLENGE_TYPES,
  type ChallengeEntry,
  type ChallengeState,
  type ChallengeThread,
  type ChallengeType,
  type NodeReceipts,
  type ReceiptRecord,
} from "@/lib/challenge-types";
import { invalidateChallengeCounts } from "./challenge-count";
import { CONTESTED_COLOR } from "./challenge-flag";

function timeAgo(iso: string): string {
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

const shortName = (name: string) => name.split("@")[0];

const inputClass =
  "w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring";

// One link in the chain of custody: who wrote it, with what method, during
// whose turn, in which investigation — plus the hash that seals it.
function ReceiptLine({ receipt }: { receipt: ReceiptRecord }) {
  return (
    <div className="space-y-0.5 text-[11px] text-muted-foreground">
      <p className="flex items-center gap-1">
        {receipt.contributor.kind === "agent" ? (
          <BotIcon className="size-3 shrink-0" />
        ) : null}
        <span className="text-foreground">
          {shortName(receipt.contributor.name)}
        </span>
        <span>
          · {receipt.method} · {timeAgo(receipt.createdAt)}
        </span>
      </p>
      {receipt.investigation ? (
        <p>
          in{" "}
          <Link
            className="text-foreground/80 transition-colors duration-150 hover:text-foreground hover:underline"
            href={`/i/${receipt.investigation.id}`}
          >
            {receipt.investigation.title}
          </Link>
          {receipt.askedBy ? ` — asked by ${shortName(receipt.askedBy)}` : ""}
        </p>
      ) : null}
      <p className="flex items-center gap-1 font-mono text-[10px]">
        <FingerprintIcon className="size-3 shrink-0" />
        {receipt.payloadHash.slice(0, 12)}…
        {receipt.signed ? " · signed" : " · unsigned"}
      </p>
    </div>
  );
}

const STATE_STYLE: Record<ChallengeState, string> = {
  undisputed: "border-border/60 text-muted-foreground",
  contested: "border-[#dc2626]/50 text-[#dc2626]",
  answered: "border-emerald-600/40 text-emerald-600",
};

function StateChip({ state }: { state: ChallengeState }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] ${STATE_STYLE[state]}`}
    >
      {state}
    </span>
  );
}

function EntryLine({ entry }: { entry: ChallengeEntry }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground">
        {entry.authorKind === "agent" ? (
          <BotIcon className="mr-1 inline size-3" />
        ) : null}
        {shortName(entry.authorName)} · {timeAgo(entry.createdAt)}
      </p>
      <p className="whitespace-pre-wrap text-xs leading-snug">{entry.body}</p>
      {entry.evidenceUrl ? (
        <a
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-colors duration-150 hover:text-foreground hover:underline"
          href={entry.evidenceUrl}
          rel="noreferrer"
          target="_blank"
        >
          evidence <ExternalLinkIcon className="size-2.5" />
        </a>
      ) : null}
    </div>
  );
}

// One dispute: the challenge, its append-only responses, and a reply box.
// Nothing closes; a response from someone else flips the derived state.
function ThreadBlock({
  thread,
  onRespond,
}: {
  thread: ChallengeThread;
  onRespond: (challengeId: string, body: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    setError(null);
    const failure = await onRespond(thread.challenge.id, body);
    setSending(false);
    setError(failure);
    // Keep the draft on failure so the response isn't lost.
    if (!failure) {
      setDraft("");
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-border/50 p-2">
      <p
        className="font-medium text-[9px] uppercase tracking-wide"
        style={{ color: CONTESTED_COLOR }}
      >
        ⚑{" "}
        {thread.challenge.challengeType
          ? CHALLENGE_TYPE_LABELS[thread.challenge.challengeType]
          : "challenge"}
      </p>
      <EntryLine entry={thread.challenge} />
      {thread.responses.length > 0 ? (
        <div className="space-y-2 border-border/50 border-l-2 pl-2">
          {thread.responses.map((response) => (
            <EntryLine entry={response} key={response.id} />
          ))}
        </div>
      ) : null}
      {sending ? (
        <p className="text-[10px] text-muted-foreground">
          <span className="shimmer">…</span>
        </p>
      ) : null}
      {error ? (
        <p className="text-[10px] text-destructive/80">{error}</p>
      ) : null}
      <input
        className={inputClass}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Respond — this never deletes the challenge"
        type="text"
        value={draft}
      />
    </div>
  );
}

function ChallengeForm({
  kind,
  onSubmit,
  onCancel,
}: {
  kind: string;
  onSubmit: (input: {
    challengeType: ChallengeType;
    body: string;
    evidenceUrl: string;
  }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [challengeType, setChallengeType] =
    useState<ChallengeType>("counter_evidence");
  const [body, setBody] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!body.trim() || sending) {
      return;
    }
    setSending(true);
    setError(null);
    // On failure the parent leaves the form mounted, inputs intact.
    setError(await onSubmit({ challengeType, body, evidenceUrl }));
    setSending(false);
  };
  return (
    <div className="space-y-2 rounded-md border border-border/50 p-2">
      <div className="flex flex-wrap gap-1">
        {CHALLENGE_TYPES.map((type) => (
          <button
            className={`rounded-full border px-2 py-0.5 text-[10px] transition-[background-color,border-color,color] duration-150 ${
              type === challengeType
                ? "border-border bg-muted text-foreground"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
            key={type}
            onClick={() => setChallengeType(type)}
            type="button"
          >
            {CHALLENGE_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      <textarea
        className={`${inputClass} min-h-16 resize-none`}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Why is this ${kind} wrong, misread, or unsound?`}
        value={body}
      />
      <input
        className={inputClass}
        onChange={(e) => setEvidenceUrl(e.target.value)}
        placeholder="Evidence URL or doi:… (optional)"
        type="url"
        value={evidenceUrl}
      />
      {error ? (
        <p className="text-[10px] text-destructive/80">{error}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-foreground px-2 py-1 text-[11px] text-background transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          disabled={!body.trim() || sending}
          onClick={submit}
          type="button"
        >
          {sending ? "filing…" : "File challenge"}
        </button>
        <button
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

// The Inspector's receipts + disputes: the node's chain of custody (who,
// how, during whose turn, from which sources) and its append-only challenge
// record. Everything here is derived from contributions — the graph never
// stores "the answer", only who said what and when.
export function NodeProvenance({
  nodeId,
  nodeLabel,
}: {
  nodeId: string;
  /** Human-readable label — awareness-ticker narration on other clients. */
  nodeLabel?: string;
}) {
  const room = useRoom();
  const { channel, roomId, me } = room;
  const { on, send } = channel;
  const [receipts, setReceipts] = useState<NodeReceipts | null>(null);
  const [challenging, setChallenging] = useState(false);

  const refetch = useCallback(async () => {
    setReceipts(await getNodeReceiptsAction(nodeId));
  }, [nodeId]);

  // The Inspector keys this component by node id, so a node switch remounts
  // with fresh state — this effect only ever runs the initial fetch.
  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => on("challenges:changed", () => refetch()), [on, refetch]);

  const afterMutation = useCallback(
    (action: "challenged" | "responded") => {
      refetch();
      invalidateChallengeCounts();
      send("challenges:changed", {
        nodeId,
        actorId: me.userId,
        actorName: me.displayName,
        nodeLabel,
        action,
      });
    },
    [refetch, send, nodeId, nodeLabel, me.userId, me.displayName]
  );

  const file = useCallback(
    async (input: {
      challengeType: ChallengeType;
      body: string;
      evidenceUrl: string;
    }): Promise<string | null> => {
      const result = await fileNodeChallenge({
        nodeId,
        challengeType: input.challengeType,
        body: input.body,
        evidenceUrl: input.evidenceUrl || null,
        sessionId: roomId,
      });
      if (!result.ok) {
        return result.error ?? "couldn't file the challenge";
      }
      setChallenging(false);
      afterMutation("challenged");
      return null;
    },
    [nodeId, roomId, afterMutation]
  );

  const respond = useCallback(
    async (challengeId: string, body: string): Promise<string | null> => {
      const result = await respondToChallengeAction({
        challengeId,
        body,
        sessionId: roomId,
      });
      if (!result.ok) {
        return result.error ?? "couldn't respond";
      }
      afterMutation("responded");
      return null;
    },
    [roomId, afterMutation]
  );

  if (!receipts) {
    return (
      <p className="text-[11px] text-muted-foreground">
        <span className="shimmer">loading receipts…</span>
      </p>
    );
  }

  const challengeable = receipts.kind !== "crux";

  return (
    <>
      <div>
        <p className="mb-1.5 font-medium text-muted-foreground text-xs">
          Receipts
        </p>
        {receipts.created ? (
          <ReceiptLine receipt={receipts.created} />
        ) : (
          <p className="text-[11px] text-muted-foreground">
            no contribution record
          </p>
        )}
        {receipts.mentions.length > 0 ? (
          <div className="mt-2 space-y-1">
            {receipts.mentions.map((mention) => (
              <p
                className="text-[10px] text-muted-foreground"
                key={`${mention.sourceId}-${mention.quote.slice(0, 24)}`}
              >
                ↳ extracted from{" "}
                <span className="text-foreground/80">
                  {mention.sourceTitle ?? "source"}
                </span>
                {mention.receipt
                  ? ` by ${shortName(mention.receipt.contributor.name)} · ${timeAgo(mention.receipt.createdAt)}`
                  : ""}
                {mention.receipt?.askedBy
                  ? ` (asked by ${shortName(mention.receipt.askedBy)})`
                  : ""}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="font-medium text-muted-foreground text-xs">Disputes</p>
          <StateChip state={receipts.state} />
        </div>
        {receipts.threads.length > 0 ? (
          <div className="space-y-2">
            {receipts.threads.map((thread) => (
              <ThreadBlock
                key={thread.challenge.id}
                onRespond={respond}
                thread={thread}
              />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {challengeable
              ? "No one has challenged this yet."
              : "Cruxes are open questions — nothing asserted to dispute."}
          </p>
        )}
        {challengeable && !challenging ? (
          <button
            className="mt-2 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-[background-color,color] duration-150 hover:bg-muted hover:text-foreground"
            onClick={() => setChallenging(true)}
            type="button"
          >
            <FlagIcon className="size-3" /> Challenge this {receipts.kind}
          </button>
        ) : null}
        {challenging ? (
          <div className="mt-2">
            <ChallengeForm
              kind={receipts.kind}
              onCancel={() => setChallenging(false)}
              onSubmit={file}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
