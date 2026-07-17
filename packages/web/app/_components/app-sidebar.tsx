"use client";

import { GitForkIcon, LogOutIcon, PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CommonsSearchMenuItem } from "@/app/_components/commons/commons-search";
import { graphBus } from "@/app/_components/graph/graph-bus";
import { useNav } from "@/app/_components/nav-context";
import { AvatarStack } from "@/app/_components/presence/presence-avatars";
import { useRoom } from "@/app/_components/room-provider";
import { signOut } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { InvestigationListItem } from "@/lib/investigations";
import { colorForUser, initialsFor } from "@/lib/realtime/color";

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

export function AppSidebar({
  me,
  investigations,
}: {
  me: { userId: string; displayName: string };
  investigations: InvestigationListItem[];
}) {
  const room = useRoom();
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
  const currentPersisted = Boolean(
    currentId && investigations.some((i) => i.id === currentId)
  );
  // A just-started room shows as a synthetic row until router.refresh lands it.
  const showLiveCurrent = Boolean(liveTitle) && !currentPersisted;

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
                {investigations.map((inv) => (
                  <SidebarMenuItem key={inv.id}>
                    <SidebarMenuButton
                      asChild
                      className={itemClass}
                      isActive={!commonsActive && inv.id === currentId}
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
                            {inv.ownerId === me.userId
                              ? "you"
                              : inv.ownerName.split("@")[0]}
                            {inv.forkedFrom ? " · fork" : ""}
                          </span>
                        </span>
                        <AvatarStack
                          people={(room.lobby.get(inv.id) ?? []).map((p) => ({
                            userId: p.userId,
                            displayName: p.displayName,
                            color: p.color,
                          }))}
                          size="size-4"
                          text="text-[8px]"
                        />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
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
