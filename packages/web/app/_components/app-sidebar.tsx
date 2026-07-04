"use client";

import { GitForkIcon, LogOutIcon, PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useNav } from "@/app/_components/nav-context";
import { AvatarStack } from "@/app/_components/presence/presence-avatars";
import { useRoom } from "@/app/_components/room-provider";
import { signOut } from "@/app/(auth)/actions";
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
} from "@/components/ui/sidebar";
import type { InvestigationListItem } from "@/lib/investigations";

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
  const messages = (room.data as { messages?: readonly Msg[] })?.messages ?? [];
  // The open investigation: the route's id, or the live session's id.
  const currentId =
    (typeof params.id === "string" ? params.id : null) ??
    room.session.sessionId ??
    null;
  const liveTitle = firstUserQuestion(messages);
  const currentPersisted = Boolean(
    currentId && investigations.some((i) => i.id === currentId)
  );
  // A just-started room shows as a synthetic row until router.refresh lands it.
  const showLiveCurrent = Boolean(liveTitle) && !currentPersisted;

  return (
    <Sidebar>
      <SidebarHeader className="gap-2 p-3">
        <span className="px-1 font-semibold text-sm">epistemic-stack</span>
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
                      isActive
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
                      isActive={inv.id === currentId}
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

      <SidebarFooter className="p-3">
        <div className="flex flex-col gap-1">
          <span className="truncate px-1 text-muted-foreground text-xs">
            {me.displayName}
          </span>
          <form action={signOut}>
            <SidebarMenuButton className="justify-start" type="submit">
              <LogOutIcon className="size-4" />
              Sign out
            </SidebarMenuButton>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
