"use client";

import { EyeIcon, EyeOffIcon, ScaleIcon, SparklesIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { getPersonStats } from "@/app/(chat)/people-actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PresenceMeta } from "@/lib/realtime/types";
import { peopleBus, usePeopleState } from "./people-bus";

const actionClass =
  "flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/60 px-2 py-1.5 text-xs transition-[background-color,border-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97]";

function lastActiveLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function whereLabel(meta: PresenceMeta): string {
  if (meta.activity === "touring") {
    return "touring the graph";
  }
  if (meta.activity === "chatting") {
    return "cursor-chatting in the graph";
  }
  return meta.view === "graph" ? "in the graph" : "in the chat";
}

// The person card — one hub per teammate. Everything social hangs off it:
// where they are, follow their viewport, or line your credences up against
// theirs.
export function PersonCard({
  meta,
  isSelf,
  children,
}: {
  meta: PresenceMeta;
  isSelf: boolean;
  children: ReactNode;
}) {
  const { follow } = usePeopleState();
  const [stats, setStats] = useState<{
    contributions: number;
    lastAt: string | null;
  } | null>(null);
  const followingThem = follow?.userId === meta.userId;

  const onOpenChange = (open: boolean) => {
    if (open && !stats) {
      getPersonStats(meta.userId)
        .then((s) => setStats(s ?? { contributions: 0, lastAt: null }))
        .catch(() => setStats({ contributions: 0, lastAt: null }));
    }
  };

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0">
        <div className="flex items-center gap-2 border-border/40 border-b px-3 py-2.5">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: meta.color }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-sm">
              {meta.displayName.split("@")[0]}
              {isSelf ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · you
                </span>
              ) : null}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {whereLabel(meta)}
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <SparklesIcon className="size-3.5 shrink-0" />
            {stats ? (
              <span className="truncate">
                {stats.contributions} contribution
                {stats.contributions === 1 ? "" : "s"} to the commons
                {stats.lastAt ? ` · ${lastActiveLabel(stats.lastAt)}` : ""}
              </span>
            ) : (
              <span className="text-muted-foreground/60">…</span>
            )}
          </span>
        </div>

        {isSelf ? null : (
          <div className="flex gap-1.5 border-border/40 border-t px-3 py-2.5">
            <button
              className={`${actionClass} ${followingThem ? "border-border bg-muted text-foreground" : "text-muted-foreground"}`}
              onClick={() =>
                peopleBus.setFollow(
                  followingThem
                    ? null
                    : { userId: meta.userId, displayName: meta.displayName }
                )
              }
              type="button"
            >
              {followingThem ? (
                <EyeOffIcon className="size-3.5" />
              ) : (
                <EyeIcon className="size-3.5" />
              )}
              {followingThem ? "Unfollow" : "Follow"}
            </button>
            <button
              className={`${actionClass} text-muted-foreground`}
              onClick={() =>
                peopleBus.setCompare({
                  contributorId: meta.userId,
                  displayName: meta.displayName,
                })
              }
              title="Rank hypotheses by how far apart your credences are"
              type="button"
            >
              <ScaleIcon className="size-3.5" />
              Compare
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
