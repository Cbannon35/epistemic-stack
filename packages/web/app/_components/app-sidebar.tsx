"use client";

import { LogOutIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useEveChat } from "@/app/_components/eve-session";
import { useNav } from "@/app/_components/nav-context";
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

type Msg = {
  role: string;
  parts?: Array<{ type?: string; text?: string }>;
  text?: string;
};
type Investigation = { id: string; title: string };

function firstUserQuestion(messages: Msg[]): string | null {
  const first = messages.find((m) => m.role === "user");
  if (!first) {
    return null;
  }
  const text =
    (first.parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join(" ") ||
    first.text ||
    "";
  return text.trim() || null;
}

const itemClass =
  "h-auto items-start justify-start whitespace-normal py-1.5 text-left";

export function AppSidebar({
  userEmail,
  investigations,
}: {
  userEmail: string | null;
  investigations: Investigation[];
}) {
  const agent = useEveChat();
  const { selectedId, newInvestigation, selectInvestigation } = useNav();
  const messages = (agent.data as { messages?: Msg[] })?.messages ?? [];
  // The open investigation is the resumed selection, or the live session's id.
  const currentId = selectedId ?? agent.session?.sessionId;
  const liveTitle = firstUserQuestion(messages);
  const currentPersisted = Boolean(
    currentId && investigations.some((i) => i.id === currentId)
  );
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
                      className={itemClass}
                      isActive={inv.id === currentId}
                      onClick={() => selectInvestigation(inv.id)}
                    >
                      <SearchIcon className="mt-0.5 size-4 shrink-0" />
                      <span className="line-clamp-2">{inv.title}</span>
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
        {userEmail ? (
          <div className="flex flex-col gap-1">
            <span className="truncate px-1 text-muted-foreground text-xs">
              {userEmail}
            </span>
            <form action={signOut}>
              <SidebarMenuButton className="justify-start" type="submit">
                <LogOutIcon className="size-4" />
                Sign out
              </SidebarMenuButton>
            </form>
          </div>
        ) : (
          <p className="px-1 text-muted-foreground text-xs">Signed out</p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
