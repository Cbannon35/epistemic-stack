"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useRoom } from "@/app/_components/room-provider";
import { colorForUser, EVE_COLOR } from "@/lib/realtime/color";
import { dedupeByUser } from "@/lib/realtime/types";

// The awareness ticker: an ephemeral toast stack narrating OTHER members'
// actions (broadcasts are self:false, and local sources filter "mine"). Not a
// notification center — items expire on their own and nothing is persisted.

const MAX_ITEMS = 4;
const TTL_MS = 6500;
/** A leave inside this window is treated as a refresh, not a departure. */
const LEAVE_GRACE_MS = 6000;
const LABEL_MAX = 64;

type TickerItem = {
  id: number;
  text: string;
  /** Accent dot — the actor's identity color (violet for eve). */
  color?: string;
  at: number;
};

const trim = (s: string) =>
  s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s;

const firstName = (s: string) => s.split("@")[0];

function deltaPhrase(delta: {
  claims: number;
  sources: number;
  relations: number;
  cruxes: number;
  hypotheses: number;
}): string {
  const parts: string[] = [];
  const word = (n: number, singular: string, plural = `${singular}s`) =>
    `+${n} ${n === 1 ? singular : plural}`;
  if (delta.claims > 0) {
    parts.push(word(delta.claims, "claim"));
  }
  if (delta.sources > 0) {
    parts.push(word(delta.sources, "source"));
  }
  if (delta.relations > 0) {
    parts.push(word(delta.relations, "relation"));
  }
  if (delta.cruxes > 0) {
    parts.push(word(delta.cruxes, "crux", "cruxes"));
  }
  if (delta.hypotheses > 0) {
    parts.push(word(delta.hypotheses, "hypothesis", "hypotheses"));
  }
  return parts.join(" · ");
}

export function RoomTicker() {
  const room = useRoom();
  const { channel, me, roomId } = room;
  const { on } = channel;
  const [items, setItems] = useState<TickerItem[]>([]);
  const idRef = useRef(0);
  const pausedRef = useRef(false);
  // Delegation hosts by id — names for the completion line.
  const hostsRef = useRef(new Map<string, string>());
  // Presence roster (userId → displayName) for join/leave narration.
  const rosterRef = useRef<Map<string, string> | null>(null);
  const leaveTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const mineRef = useRef(false);
  mineRef.current = room.activeTurn?.mine ?? false;

  const push = useCallback((text: string, color?: string) => {
    idRef.current += 1;
    const item = { id: idRef.current, text, color, at: Date.now() };
    setItems((prev) => [...prev.slice(-(MAX_ITEMS - 1)), item]);
  }, []);

  // Expiry sweep (paused while hovered so items stay readable).
  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current) {
        return;
      }
      setItems((prev) => {
        const now = Date.now();
        const next = prev.filter((i) => now - i.at < TTL_MS);
        return next.length === prev.length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Room switch: clear everything, re-baseline the roster.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roomId is the reset trigger; the body intentionally reads nothing from it
  useEffect(() => {
    setItems([]);
    rosterRef.current = null;
    hostsRef.current.clear();
    const timers = leaveTimersRef.current;
    for (const t of timers.values()) {
      clearTimeout(t);
    }
    timers.clear();
  }, [roomId]);

  // Disputes — enriched payloads only (bare refetch signals stay silent).
  useEffect(
    () =>
      on("challenges:changed", (p) => {
        if (!(p.actorName && p.action)) {
          return;
        }
        const target = p.nodeLabel ? ` on “${trim(p.nodeLabel)}”` : "";
        const verb = p.action === "challenged" ? "challenged" : "responded";
        push(
          `${firstName(p.actorName)} ${verb}${target}`,
          p.actorId ? colorForUser(p.actorId) : undefined
        );
      }),
    [on, push]
  );

  // Comments.
  useEffect(
    () =>
      on("comments:changed", (p) => {
        if (!(p.actorName && p.action)) {
          return;
        }
        const color = p.actorId ? colorForUser(p.actorId) : undefined;
        const name = firstName(p.actorName);
        if (p.action === "commented") {
          const quote = p.quote ? ` on “${trim(p.quote)}”` : "";
          push(`${name} commented${quote}`, color);
        } else if (p.action === "replied") {
          push(`${name} replied in a thread`, color);
        } else {
          push(`${name} resolved a thread`, color);
        }
      }),
    [on, push]
  );

  // Beliefs going on the record.
  useEffect(
    () =>
      on("credence:recorded", (p) => {
        push(
          `${firstName(p.displayName)} put ${p.value}% on “${trim(p.hypothesisLabel)}”`,
          colorForUser(p.userId)
        );
      }),
    [on, push]
  );

  // Delegated investigations.
  useEffect(
    () =>
      on("delegation-start", (p) => {
        hostsRef.current.set(p.delegationId, p.hostName);
        push(
          `${firstName(p.hostName)} sent eve to investigate “${trim(p.brief)}”`,
          EVE_COLOR
        );
      }),
    [on, push]
  );
  useEffect(
    () =>
      on("delegation-end", (p) => {
        const host = hostsRef.current.get(p.delegationId);
        hostsRef.current.delete(p.delegationId);
        const name = host ? firstName(host) : "a teammate";
        if (p.reason === "complete") {
          push(`eve finished ${name}'s investigation`, EVE_COLOR);
        } else if (p.reason === "cancelled") {
          push(`${name} called eve back`, EVE_COLOR);
        } else {
          push(`eve's investigation for ${name} failed`, EVE_COLOR);
        }
      }),
    [on, push]
  );

  // Join/leave — by PERSON, first sync skipped, refresh churn swallowed.
  useEffect(() => {
    const people = dedupeByUser(channel.peers.values());
    const current = new Map(people.map((p) => [p.userId, p.displayName]));
    const timers = leaveTimersRef.current;
    if (rosterRef.current === null) {
      rosterRef.current = current;
      return;
    }
    const roster = rosterRef.current;
    for (const [userId, name] of current) {
      const pending = timers.get(userId);
      if (pending) {
        // Back within grace — a refresh, not a departure.
        clearTimeout(pending);
        timers.delete(userId);
      }
      if (!roster.has(userId)) {
        roster.set(userId, name);
        if (userId !== me.userId) {
          push(`${firstName(name)} joined`, colorForUser(userId));
        }
      }
    }
    for (const [userId, name] of roster) {
      if (!(current.has(userId) || timers.has(userId))) {
        timers.set(
          userId,
          setTimeout(() => {
            timers.delete(userId);
            roster.delete(userId);
            if (userId !== me.userId) {
              push(`${firstName(name)} left`, colorForUser(userId));
            }
          }, LEAVE_GRACE_MS)
        );
      }
    }
  }, [channel.peers, me.userId, push]);

  // Graph growth (local bus, fires for everyone) — silent while MY turn is
  // the one writing; the streaming answer already narrates that.
  useEffect(
    () =>
      graphBus.on("graphDelta", (delta) => {
        if (mineRef.current) {
          return;
        }
        const phrase = deltaPhrase(delta);
        if (phrase) {
          push(`graph grew: ${phrase}`);
        }
      }),
    [push]
  );

  if (!roomId || items.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-80 flex-col items-end gap-1.5">
      {items.map((item) => (
        <button
          className="fade-in pointer-events-auto flex max-w-full cursor-default items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground shadow-float backdrop-blur"
          key={item.id}
          onClick={() =>
            setItems((prev) => prev.filter((i) => i.id !== item.id))
          }
          onPointerEnter={() => {
            pausedRef.current = true;
          }}
          onPointerLeave={() => {
            pausedRef.current = false;
          }}
          title="Dismiss"
          type="button"
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.color ?? "var(--border)" }}
          />
          <span className="truncate">{item.text}</span>
        </button>
      ))}
    </div>
  );
}
