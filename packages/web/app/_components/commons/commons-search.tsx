"use client";

import {
  CircleDotIcon,
  FileTextIcon,
  HelpCircleIcon,
  LightbulbIcon,
  SearchIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useRoom } from "@/app/_components/room-provider";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { CommonsHit } from "@/lib/commons-search";

// Search everything anyone has established, across every investigation — the
// compounding read surface. Hits carry their origin (which investigation, who
// recorded it); selecting one either focuses the node here or jumps to the
// investigation that produced it.

const KIND_META: Record<
  CommonsHit["kind"],
  { label: string; icon: typeof SearchIcon; color: string }
> = {
  claim: { label: "claim", icon: CircleDotIcon, color: "#2563eb" },
  hypothesis: { label: "hypothesis", icon: LightbulbIcon, color: "#7c3aed" },
  crux: { label: "crux", icon: HelpCircleIcon, color: "#d97706" },
  source: { label: "source", icon: FileTextIcon, color: "#6b7280" },
};

const DEBOUNCE_MS = 250;

export function CommonsSearchMenuItem() {
  const room = useRoom();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CommonsHit[]>([]);
  const [searching, setSearching] = useState(false);
  const requestRef = useRef(0);

  // ⌘K / ctrl+K from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Debounced async search — cmdk filtering is off; the server ranks.
  useEffect(() => {
    if (!open) {
      return;
    }
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++requestRef.current;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        const res = await fetch(`/api/commons/search?${params}`);
        if (!res.ok || id !== requestRef.current) {
          return;
        }
        const body = (await res.json()) as { hits: CommonsHit[] };
        if (id === requestRef.current) {
          setHits(body.hits);
        }
      } catch {
        // Stale or failed request — keep the previous results.
      } finally {
        if (id === requestRef.current) {
          setSearching(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  const select = (hit: CommonsHit) => {
    setOpen(false);
    if (hit.investigationId && hit.investigationId !== room.roomId) {
      router.push(`/i/${encodeURIComponent(hit.investigationId)}`);
      return;
    }
    // Same investigation (or unattributed): focus it in the graph panel.
    graphBus.emit("focusNode", { nodeId: hit.nodeId });
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="justify-start"
        onClick={() => setOpen(true)}
      >
        <SearchIcon className="size-4" />
        Search the commons
        <span className="ml-auto text-[10px] text-muted-foreground tracking-widest">
          ⌘K
        </span>
      </SidebarMenuButton>
      <CommandDialog
        description="Search claims, hypotheses, cruxes and sources across every investigation"
        onOpenChange={setOpen}
        open={open}
        title="Search the commons"
      >
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search everything anyone has established…"
            value={query}
          />
          <CommandList>
            {query.trim() === "" ? (
              <p className="px-4 py-6 text-center text-muted-foreground text-sm">
                The commons compounds — search what other investigations already
                established before re-researching.
              </p>
            ) : hits.length === 0 ? (
              <p className="px-4 py-6 text-center text-muted-foreground text-sm">
                {searching ? "Searching…" : "Nothing recorded on that yet."}
              </p>
            ) : (
              <div className="p-1">
                {hits.map((hit) => {
                  const meta = KIND_META[hit.kind];
                  const Icon = meta.icon;
                  return (
                    <CommandItem
                      className="items-start gap-2.5 data-selected:bg-muted"
                      key={`${hit.kind}:${hit.nodeId}`}
                      onSelect={() => select(hit)}
                      value={`${hit.kind}:${hit.nodeId}`}
                    >
                      <Icon
                        className="mt-0.5 size-4 shrink-0"
                        style={{ color: meta.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 leading-snug">
                          {hit.text}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {meta.label}
                          {hit.investigationTitle
                            ? ` · from "${hit.investigationTitle}"`
                            : " · shared commons"}
                          {hit.contributorName
                            ? ` · ${hit.contributorName.split("@")[0]}`
                            : ""}
                          {hit.investigationId === room.roomId
                            ? " · this investigation"
                            : ""}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </div>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </SidebarMenuItem>
  );
}
