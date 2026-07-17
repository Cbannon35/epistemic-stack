"use client";

import {
  ChevronRightIcon,
  GitForkIcon,
  GitMergeIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CommonsSearchMenuItem } from "@/app/_components/commons/commons-search";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useNav } from "@/app/_components/nav-context";
import { AvatarStack } from "@/app/_components/presence/presence-avatars";
import { useRoom } from "@/app/_components/room-provider";
import { signOut } from "@/app/(auth)/actions";
import { renameInvestigationAction } from "@/app/(chat)/actions";
import { deleteForkAction } from "@/app/(chat)/fork-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { InvestigationListItem } from "@/lib/investigations";
import { colorForUser, initialsFor } from "@/lib/realtime/color";
import type { LobbyMeta } from "@/lib/realtime/types";

type Msg = {
  role: string;
  parts?: ReadonlyArray<{ type?: string; text?: string }>;
};

function firstUserQuestion(messages: readonly Msg[]): string | null {
  const first = messages.find((m) => m.role === "user");
  if (!first) {
    return null;
  }
  const text = (first.parts ?? [])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join(" ");
  return text.trim() || null;
}

const itemClass =
  "h-auto items-start justify-start whitespace-normal py-1.5 text-left";

// GitHub-style fork tree: group the flat (updatedAt-ordered) page by
// forkedFrom. A fork whose parent fell off the 50-item page renders at top
// level rather than vanishing.
function buildForkTree(investigations: InvestigationListItem[]): {
  roots: InvestigationListItem[];
  byParent: Map<string, InvestigationListItem[]>;
} {
  const present = new Set(investigations.map((i) => i.id));
  const roots: InvestigationListItem[] = [];
  const byParent = new Map<string, InvestigationListItem[]>();
  for (const inv of investigations) {
    if (inv.forkedFrom && present.has(inv.forkedFrom)) {
      const list = byParent.get(inv.forkedFrom);
      if (list) {
        list.push(inv);
      } else {
        byParent.set(inv.forkedFrom, [inv]);
      }
    } else {
      roots.push(inv);
    }
  }
  return { roots, byParent };
}

// Owner-only rename, revealed on row hover. Popover keeps the row a plain
// link; router.refresh() lands the new title in everyone's list.
function RenameAction({
  inv,
  className,
}: {
  inv: InvestigationListItem;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(inv.title);
  const [saving, setSaving] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) {
      return;
    }
    setSaving(true);
    renameInvestigationAction({ id: inv.id, title: trimmed })
      .then(() => {
        setOpen(false);
        router.refresh();
      })
      .finally(() => setSaving(false));
  };
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTitle(inv.title);
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <SidebarMenuAction
          aria-label="Rename investigation"
          className={className}
          showOnHover
          title="Rename"
        >
          <PencilIcon />
        </SidebarMenuAction>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2" side="right">
        <form className="flex items-center gap-2" onSubmit={submit}>
          <Input
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            value={title}
          />
          <Button disabled={!title.trim() || saving} size="sm" type="submit">
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

// GitHub-style fork controls: rename, merge (placeholder for now), and delete
// behind an explicit confirmation. Deleting removes only the app-side branch
// record — commons receipts are append-only and stay.
function ForkRowMenu({
  inv,
  className,
  onDeleted,
}: {
  inv: InvestigationListItem;
  className?: string;
  onDeleted: (id: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState(inv.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setMode(null);
    setError(null);
  };
  const rename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    renameInvestigationAction({ id: inv.id, title: trimmed })
      .then(() => {
        close();
        router.refresh();
      })
      .finally(() => setBusy(false));
  };
  const remove = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    deleteForkAction({ id: inv.id })
      .then((res) => {
        if ("error" in res) {
          setError(res.error);
          return;
        }
        close();
        // Hide the row instantly; then make it durable. Deleting the room
        // you're standing in needs a hard navigation — a soft push keeps the
        // stale cached sidebar (and a dead room) mounted.
        onDeleted(inv.id);
        if (pathname === `/i/${inv.id}`) {
          window.location.assign("/");
        } else {
          router.refresh();
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <Popover
      onOpenChange={(open) => (open ? null : close())}
      open={mode !== null}
    >
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              aria-label="Fork actions"
              className={className}
              showOnHover
              title="Fork actions"
            >
              <MoreHorizontalIcon />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem
            onSelect={() => {
              setTitle(inv.title);
              setMode("rename");
            }}
          >
            <PencilIcon /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <GitMergeIcon /> Merge into parent
            <span className="ml-auto text-[10px] text-muted-foreground">
              soon
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setMode("delete")}
            variant="destructive"
          >
            <Trash2Icon /> Delete fork…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="start"
        className="w-72 p-3"
        // The dropdown returning focus to the shared trigger must not count
        // as "outside" — it would dismiss the confirmation as it opens.
        onFocusOutside={(e) => e.preventDefault()}
        side="right"
      >
        {mode === "rename" ? (
          <form className="flex items-center gap-2" onSubmit={rename}>
            <Input
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              value={title}
            />
            <Button disabled={!title.trim() || busy} size="sm" type="submit">
              Save
            </Button>
          </form>
        ) : (
          <div className="space-y-2">
            <p className="font-medium text-sm">Delete this fork?</p>
            <p className="text-muted-foreground text-xs">
              Its transcript, comments and delegation records go away. Claims
              and sources it recorded stay in the commons — receipts are
              append-only.
            </p>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button onClick={close} size="sm" type="button" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={remove}
                size="sm"
                type="button"
                variant="destructive"
              >
                {busy ? "Deleting…" : "Delete fork"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

type NodeContext = {
  me: { userId: string; displayName: string };
  currentId: string | null;
  commonsActive: boolean;
  lobby: ReadonlyMap<string, LobbyMeta[]>;
  byParent: Map<string, InvestigationListItem[]>;
  /** Optimistically hide a deleted fork while the refresh confirms it. */
  onDeleted: (id: string) => void;
};

// One investigation row, recursing into its forks (collapsible, default open).
function InvestigationNode({
  inv,
  ctx,
}: {
  inv: InvestigationListItem;
  ctx: NodeContext;
}) {
  const forks = ctx.byParent.get(inv.id) ?? [];
  const mine = inv.ownerId === ctx.me.userId;
  const row = (
    <>
      <SidebarMenuButton
        asChild
        className={itemClass}
        isActive={!ctx.commonsActive && inv.id === ctx.currentId}
      >
        <Link href={`/i/${encodeURIComponent(inv.id)}`}>
          {inv.forkedFrom ? (
            <GitForkIcon className="mt-0.5 size-4 shrink-0" />
          ) : (
            <SearchIcon className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2">{inv.title}</span>
            <span className="text-[10px] text-muted-foreground">
              {mine ? "you" : inv.ownerName.split("@")[0]}
              {inv.forkedFrom ? " · fork" : ""}
            </span>
          </span>
          <AvatarStack
            people={(ctx.lobby.get(inv.id) ?? []).map((p) => ({
              userId: p.userId,
              displayName: p.displayName,
              color: p.color,
            }))}
            size="size-4"
            text="text-[8px]"
          />
        </Link>
      </SidebarMenuButton>
      {mine && inv.forkedFrom ? (
        <ForkRowMenu
          className={forks.length > 0 ? "right-6" : undefined}
          inv={inv}
          onDeleted={ctx.onDeleted}
        />
      ) : null}
      {mine && !inv.forkedFrom ? (
        <RenameAction
          className={forks.length > 0 ? "right-6" : undefined}
          inv={inv}
        />
      ) : null}
    </>
  );
  if (forks.length === 0) {
    return <SidebarMenuItem>{row}</SidebarMenuItem>;
  }
  return (
    <CollapsiblePrimitive.Root asChild defaultOpen>
      <SidebarMenuItem>
        {row}
        <CollapsiblePrimitive.Trigger asChild>
          <SidebarMenuAction
            aria-label="Toggle forks"
            className="transition-transform duration-150 data-[state=open]:rotate-90"
            title="Forks"
          >
            <ChevronRightIcon />
          </SidebarMenuAction>
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Content>
          <SidebarMenuSub className="mt-1">
            {forks.map((fork) => (
              <InvestigationNode ctx={ctx} inv={fork} key={fork.id} />
            ))}
          </SidebarMenuSub>
        </CollapsiblePrimitive.Content>
      </SidebarMenuItem>
    </CollapsiblePrimitive.Root>
  );
}

export function AppSidebar({
  me,
  investigations,
}: {
  me: { userId: string; displayName: string };
  investigations: InvestigationListItem[];
}) {
  const room = useRoom();
  const router = useRouter();
  const { newInvestigation } = useNav();
  const params = useParams<{ id?: string }>();
  // While the whole-commons view is on screen, "Search the commons" is the
  // selected thing — not the route's investigation row.
  const [commonsActive, setCommonsActive] = useState(false);
  useEffect(
    () => graphBus.on("commonsScope", ({ active }) => setCommonsActive(active)),
    []
  );
  const messages = (room.data as { messages?: readonly Msg[] })?.messages ?? [];
  // The open investigation: the route's id, or the live room's durable id.
  const currentId =
    (typeof params.id === "string" ? params.id : null) ?? room.roomId ?? null;
  const liveTitle = firstUserQuestion(messages);
  // Deleted forks vanish immediately; the follow-up refresh makes it durable.
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const visible = investigations.filter((i) => !deletedIds.has(i.id));
  const currentPersisted = Boolean(
    currentId && visible.some((i) => i.id === currentId)
  );
  const isForkRoom = Boolean(currentId?.startsWith("fork_"));
  // A just-created fork navigates before the client router re-fetches the
  // shared layout, so its (already durable) row is briefly missing from the
  // list. Refresh once to pull it in, nested under its parent — never fall
  // back to a top-level synthetic row for it.
  const refreshedForkRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      isForkRoom &&
      !currentPersisted &&
      refreshedForkRef.current !== currentId
    ) {
      refreshedForkRef.current = currentId;
      router.refresh();
    }
  }, [isForkRoom, currentPersisted, currentId, router]);
  // A just-started room shows as a synthetic row until router.refresh lands it.
  const showLiveCurrent =
    Boolean(liveTitle) && !currentPersisted && !isForkRoom;
  const { roots, byParent } = buildForkTree(visible);
  const nodeCtx: NodeContext = {
    me,
    currentId,
    commonsActive,
    lobby: room.lobby,
    byParent,
    onDeleted: (id) => setDeletedIds((prev) => new Set(prev).add(id)),
  };

  return (
    // Icon rail when collapsed: the toggle, search, and your avatar stay
    // reachable even when the graph has the whole screen.
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2 p-3 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate px-1 font-semibold text-sm group-data-[collapsible=icon]:hidden">
            epistemic-stack
          </span>
          <SidebarTrigger className="shrink-0 text-muted-foreground" />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="justify-start"
              onClick={newInvestigation}
            >
              <PlusIcon className="size-4" />
              New investigation
            </SidebarMenuButton>
          </SidebarMenuItem>
          <CommonsSearchMenuItem active={commonsActive} />
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Investigations</SidebarGroupLabel>
          <SidebarGroupContent>
            {showLiveCurrent || investigations.length > 0 ? (
              <SidebarMenu>
                {showLiveCurrent ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className={`${itemClass} cursor-default`}
                      isActive={!commonsActive}
                    >
                      <SearchIcon className="mt-0.5 size-4 shrink-0" />
                      <span className="line-clamp-2">{liveTitle}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
                {roots.map((inv) => (
                  <InvestigationNode ctx={nodeCtx} inv={inv} key={inv.id} />
                ))}
              </SidebarMenu>
            ) : (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">
                Ask a question to start an investigation.
              </p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Account"
              className="flex w-full items-center gap-2 rounded-md p-1 text-left transition-colors duration-150 hover:bg-sidebar-accent"
              type="button"
            >
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full font-medium text-[10px] text-white"
                style={{ backgroundColor: colorForUser(me.userId) }}
              >
                {initialsFor(me.displayName)}
              </span>
              <span className="truncate text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">
                {me.displayName}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <form action={signOut}>
              <DropdownMenuItem asChild>
                <button className="w-full" type="submit">
                  <LogOutIcon className="size-4" />
                  Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
