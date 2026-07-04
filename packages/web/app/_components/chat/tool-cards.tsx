"use client";

import type { EveDynamicToolPart } from "eve/client";
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  SearchIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { EDGE_STYLE, positionColor } from "@/app/_components/graph/types";

// Generative UI: the agent's tool calls render as typed, clickable cards in
// the transcript instead of disappearing. Clicking a card focuses its node in
// the graph. Inputs/outputs arrive as `unknown` — narrow before reading.

const obj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const HYPOTHESIS_COLOR = "#7c3aed";
const CRUX_COLOR = "#d97706";

function CardShell({
  accent,
  onFocus,
  streaming,
  children,
}: {
  accent?: string | null;
  onFocus?: (() => void) | null;
  streaming?: boolean;
  children: ReactNode;
}) {
  const style = {
    borderLeftStyle: "solid" as const,
    borderLeftWidth: "3px",
    borderLeftColor: accent ?? "var(--border)",
  };
  const base = `message-fade-in block w-full rounded-md border border-border/50 bg-card px-2.5 py-2 text-left text-xs ${
    streaming ? "shimmer" : ""
  }`;
  if (!onFocus) {
    return (
      <div className={base} style={style}>
        {children}
      </div>
    );
  }
  return (
    <button
      className={`${base} cursor-pointer transition-[background-color,transform] duration-150 hover:bg-muted/50 active:scale-[0.99]`}
      onClick={onFocus}
      style={style}
      type="button"
    >
      {children}
    </button>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

function Skeleton({
  label,
  detail,
}: {
  label: string;
  detail?: string | null;
}) {
  return (
    <CardShell streaming>
      <span className="text-muted-foreground">{label}</span>
      {detail ? (
        <span className="mt-0.5 line-clamp-2 block text-foreground/70">
          {detail}
        </span>
      ) : null}
    </CardShell>
  );
}

function ErrorLine({ tool, message }: { tool: string; message: string }) {
  return (
    <p className="text-[11px] text-destructive/80">
      {tool} failed: {message}
    </p>
  );
}

const focus = (nodeId: string | null | undefined) =>
  nodeId ? () => graphBus.emit("focusNode", { nodeId }) : null;

// ── per-tool cards (state is output-available) ───────────────────────────────

function ClaimCard({ input, output }: { input: unknown; output: unknown }) {
  const i = obj(input);
  const o = obj(output);
  const similarity = num(o.merged_similarity);
  return (
    <CardShell
      accent={positionColor(str(i.position))}
      onFocus={focus(str(o.claim_id))}
    >
      <span className="line-clamp-3 block leading-snug">{str(i.claim)}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1">
        {str(i.evidence_type) ? (
          <Chip label={str(i.evidence_type) as string} />
        ) : null}
        {str(i.discipline) ? (
          <Chip label={str(i.discipline) as string} />
        ) : null}
        {str(i.position) ? <Chip label={str(i.position) as string} /> : null}
        <span className="text-[10px] text-muted-foreground">
          {o.is_new === false && similarity !== null
            ? `merged · ${Math.round(similarity * 100)}% match`
            : "new claim"}
        </span>
      </span>
    </CardShell>
  );
}

function SourceCard({ input, output }: { input: unknown; output: unknown }) {
  const i = obj(input);
  const o = obj(output);
  const url = str(i.url);
  const meta = [str(i.venue), str(i.date)].filter(Boolean).join(" · ");
  return (
    <CardShell onFocus={focus(str(o.source_id))}>
      <span className="flex items-start gap-1.5">
        <FileTextIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="line-clamp-2 block leading-snug">
            {str(i.title) ?? "source"}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {meta ? <span>{meta}</span> : null}
            {i.peer_reviewed === true ? <Chip label="peer-reviewed" /> : null}
            {url ? (
              <a
                className="inline-flex items-center gap-0.5 transition-colors duration-150 hover:text-foreground"
                href={url}
                onClick={(e) => e.stopPropagation()}
                rel="noreferrer"
                target="_blank"
              >
                open <ExternalLinkIcon className="size-2.5" />
              </a>
            ) : null}
          </span>
        </span>
      </span>
    </CardShell>
  );
}

function CruxCard({ input, output }: { input: unknown; output: unknown }) {
  const i = obj(input);
  const o = obj(output);
  if (o.ok === false) {
    return <ErrorLine message={str(o.error) ?? "unknown"} tool="crux" />;
  }
  const cruxId = str(o.crux_id);
  return (
    <CardShell
      accent={CRUX_COLOR}
      onFocus={focus(cruxId ? `crux:${cruxId}` : str(i.claim_id))}
    >
      <span className="font-medium text-[9px] text-muted-foreground uppercase tracking-wide">
        crux
      </span>
      <span className="line-clamp-3 block italic leading-snug">
        {str(i.question)}
      </span>
      {str(i.implication) ? (
        <span className="mt-0.5 line-clamp-2 block text-[10px] text-muted-foreground">
          if resolved: {str(i.implication)}
        </span>
      ) : null}
    </CardShell>
  );
}

function HypothesisCard({
  input,
  output,
}: {
  input: unknown;
  output: unknown;
}) {
  const i = obj(input);
  const o = obj(output);
  const id = str(o.hypothesis_id);
  return (
    <CardShell
      accent={HYPOTHESIS_COLOR}
      onFocus={focus(id ? `hyp:${id}` : null)}
    >
      <span className="font-medium text-[9px] text-muted-foreground uppercase tracking-wide">
        hypothesis
      </span>
      <span className="line-clamp-3 block leading-snug">
        {str(i.statement)}
      </span>
      {str(i.answer_bearing) ? (
        <span className="mt-1 inline-block">
          <Chip label={`answers: ${str(i.answer_bearing)}`} />
        </span>
      ) : null}
    </CardShell>
  );
}

function RelationLine({ input, output }: { input: unknown; output: unknown }) {
  const i = obj(input);
  const o = obj(output);
  if (o.ok === false) {
    return <ErrorLine message={str(o.error) ?? "unknown"} tool="relation" />;
  }
  const type = str(i.type) ?? "relates";
  const color = EDGE_STYLE[type]?.stroke ?? "var(--muted-foreground)";
  return (
    <button
      className="block w-full cursor-pointer rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-muted/50"
      onClick={() => {
        const id = str(i.from_claim_id);
        if (id) {
          graphBus.emit("focusNode", { nodeId: id });
        }
      }}
      type="button"
    >
      ↳ linked claims — <span style={{ color }}>{type.replace("_", " ")}</span>
      {str(i.rationale) ? (
        <span className="ml-1 text-muted-foreground/70">
          · {str(i.rationale)}
        </span>
      ) : null}
    </button>
  );
}

function HypLinkLine({ input, output }: { input: unknown; output: unknown }) {
  const i = obj(input);
  const o = obj(output);
  if (o.ok === false) {
    return <ErrorLine message={str(o.error) ?? "unknown"} tool="link" />;
  }
  const polarity = str(i.polarity) ?? "supports";
  const color = polarity === "supports" ? "#16a34a" : "#dc2626";
  const diagnosticity = num(i.diagnosticity);
  return (
    <button
      className="block w-full cursor-pointer rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-muted/50"
      onClick={() => {
        const id = str(i.hypothesis_id);
        if (id) {
          graphBus.emit("focusNode", { nodeId: `hyp:${id}` });
        }
      }}
      type="button"
    >
      ↳ claim <span style={{ color }}>{polarity}</span> hypothesis
      {diagnosticity === null ? null : (
        <span className="ml-1 text-muted-foreground/70">
          · d={diagnosticity.toFixed(1)}
        </span>
      )}
    </button>
  );
}

function CommonsCard({ input, output }: { input: unknown; output: unknown }) {
  const i = obj(input);
  const matches = arr(obj(output).matches);
  return (
    <CardShell>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <SearchIcon className="size-3" />
        searched commons: “{str(i.query)}”
      </span>
      {matches.length === 0 ? (
        <span className="mt-1 block text-[10px] text-muted-foreground">
          no prior claims — new territory
        </span>
      ) : (
        <span className="mt-1 block space-y-0.5">
          {matches.slice(0, 6).map((m) => {
            const match = obj(m);
            const id = str(match.claim_id);
            const similarity = num(match.similarity);
            return (
              <button
                className="flex w-full cursor-pointer items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-muted/50"
                key={id ?? str(match.text)}
                onClick={() => {
                  if (id) {
                    graphBus.emit("focusNode", { nodeId: id });
                  }
                }}
                type="button"
              >
                <span className="line-clamp-1 min-w-0 flex-1">
                  {str(match.text)}
                </span>
                {similarity === null ? null : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {Math.round(similarity * 100)}%
                  </span>
                )}
              </button>
            );
          })}
        </span>
      )}
    </CardShell>
  );
}

function SearchCard({
  toolName,
  input,
  output,
}: {
  toolName: string;
  input: unknown;
  output: unknown;
}) {
  const [open, setOpen] = useState(false);
  const i = obj(input);
  const o = obj(output);
  const results = arr(o.results);
  const label = toolName === "search_sources" ? "scholarly" : "web";
  const error = str(o.error);
  return (
    <div className="text-[11px] text-muted-foreground">
      <button
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
        />
        searched {label}: “{str(i.query)}” · {results.length} result
        {results.length === 1 ? "" : "s"}
      </button>
      {error ? <ErrorLine message={error} tool={`search ${label}`} /> : null}
      {open ? (
        <div className="mt-1 ml-4 space-y-1">
          {results.slice(0, 10).map((r) => {
            const result = obj(r);
            const url = str(result.url) ?? str(result.doi);
            const title = str(result.title) ?? url ?? "untitled";
            return (
              <div className="flex items-baseline gap-1" key={title}>
                {url ? (
                  <a
                    className="line-clamp-1 transition-colors duration-150 hover:text-foreground hover:underline"
                    href={url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {title}
                  </a>
                ) : (
                  <span className="line-clamp-1">{title}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const SKELETON_LABELS: Record<string, string> = {
  record_claim: "recording claim…",
  record_source: "recording source…",
  record_crux: "raising a crux…",
  record_hypothesis: "recording hypothesis…",
  record_relation: "linking claims…",
  link_claim_to_hypothesis: "linking to hypothesis…",
  query_commons: "searching the commons…",
  search_sources: "searching scholarly literature…",
  search_web: "searching the web…",
};

function skeletonDetail(toolName: string, input: unknown): string | null {
  const i = obj(input);
  switch (toolName) {
    case "record_claim":
      return str(i.claim);
    case "record_hypothesis":
      return str(i.statement);
    case "record_crux":
      return str(i.question);
    case "query_commons":
    case "search_sources":
    case "search_web":
      return str(i.query);
    default:
      return null;
  }
}

export function ToolCard({ part }: { part: EveDynamicToolPart }) {
  const eveKind = part.toolMetadata?.eve?.kind;
  if (eveKind === "subagent-call" || eveKind === "load-skill") {
    return (
      <p className="text-[11px] text-muted-foreground">
        ✦ {part.toolMetadata?.eve?.name ?? part.toolName}…
      </p>
    );
  }

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <Skeleton
        detail={skeletonDetail(part.toolName, part.input)}
        label={SKELETON_LABELS[part.toolName] ?? `${part.toolName}…`}
      />
    );
  }
  if (part.state === "output-error") {
    return (
      <ErrorLine
        message={part.errorText.slice(0, 200)}
        tool={part.toolName.replaceAll("_", " ")}
      />
    );
  }
  if (part.state !== "output-available") {
    // approval-requested / approval-responded / output-denied — HITL isn't
    // part of this agent's flow; render a quiet status line just in case.
    return (
      <p className="text-[11px] text-muted-foreground">
        {part.toolName.replaceAll("_", " ")} · {part.state}
      </p>
    );
  }

  switch (part.toolName) {
    case "record_claim":
      return <ClaimCard input={part.input} output={part.output} />;
    case "record_source":
      return <SourceCard input={part.input} output={part.output} />;
    case "record_crux":
      return <CruxCard input={part.input} output={part.output} />;
    case "record_hypothesis":
      return <HypothesisCard input={part.input} output={part.output} />;
    case "record_relation":
      return <RelationLine input={part.input} output={part.output} />;
    case "link_claim_to_hypothesis":
      return <HypLinkLine input={part.input} output={part.output} />;
    case "query_commons":
      return <CommonsCard input={part.input} output={part.output} />;
    case "search_sources":
    case "search_web":
      return (
        <SearchCard
          input={part.input}
          output={part.output}
          toolName={part.toolName}
        />
      );
    default:
      return (
        <p className="text-[11px] text-muted-foreground">
          ✦ {part.toolName.replaceAll("_", " ")} done
        </p>
      );
  }
}
