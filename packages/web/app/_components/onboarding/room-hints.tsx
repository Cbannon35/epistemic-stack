"use client";

import {
  AtSignIcon,
  GitForkIcon,
  HighlighterIcon,
  MicroscopeIcon,
  SearchIcon,
  SlashIcon,
} from "lucide-react";
import type { ReactNode } from "react";

// The fresh-room empty state: what to ask, plus the room's verbs — the
// features live behind keystrokes ('/', '@eve', highlight), so a new member's
// first screen is the one place to teach them.

function Verb({
  icon,
  keys,
  children,
}: {
  icon: ReactNode;
  keys: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 text-left">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/40 text-muted-foreground">
        {icon}
      </span>
      <span className="text-muted-foreground text-xs">
        <span className="font-medium text-foreground">{keys}</span> {children}
      </span>
    </div>
  );
}

export function EmptyRoomState({ forked }: { forked: boolean }) {
  return (
    <>
      <div className="text-muted-foreground">
        {forked ? (
          <GitForkIcon className="size-5" />
        ) : (
          <SearchIcon className="size-5" />
        )}
      </div>
      <div className="space-y-1">
        <h3 className="font-medium text-sm">
          {forked ? "Fork an investigation" : "Start an investigation"}
        </h3>
        <p className="text-muted-foreground text-sm">
          {forked
            ? "This branch starts from the parent's claim graph — ask where to take it next."
            : "Ask a contested, settled, or everyday question — I'll build a sourced claim graph."}
        </p>
      </div>
      <div className="mt-2 grid gap-2 rounded-lg border border-border/40 bg-muted/20 p-3">
        <Verb icon={<SlashIcon className="size-3" />} keys="/">
          on the graph — chat at your cursor
        </Verb>
        <Verb icon={<AtSignIcon className="size-3" />} keys="@eve …">
          in cursor chat — she answers, or walks everyone through the graph
        </Verb>
        <Verb
          icon={<MicroscopeIcon className="size-3" />}
          keys="@eve investigate …"
        >
          delegate a background run — her cursor works while you talk
        </Verb>
        <Verb icon={<HighlighterIcon className="size-3" />} keys="highlight">
          any message — comment publicly or note privately
        </Verb>
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        Press <span className="font-medium text-muted-foreground">?</span>{" "}
        anytime for the full reference
      </p>
    </>
  );
}
