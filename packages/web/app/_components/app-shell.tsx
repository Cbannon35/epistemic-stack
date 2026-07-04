"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { AppSidebar } from "@/app/_components/app-sidebar";
import { EveSession, type SessionInitial } from "@/app/_components/eve-session";
import { NavContext, type NavValue } from "@/app/_components/nav-context";
import { getInvestigationSession } from "@/app/(chat)/actions";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

type Current = { id: string | null; initial: SessionInitial; gen: number };

export function AppShell({
  userEmail,
  investigations,
  children,
}: {
  userEmail: string | null;
  investigations: { id: string; title: string }[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<Current>({
    id: null,
    initial: {},
    gen: 0,
  });

  // Fresh session: bump the generation so `key` changes and EveSession remounts.
  const newInvestigation = useCallback(() => {
    setCurrent((c) => ({ id: null, initial: {}, gen: c.gen + 1 }));
  }, []);

  // Resume: load the saved snapshot in the handler, then remount seeded with it.
  const selectInvestigation = useCallback(async (id: string) => {
    const data = await getInvestigationSession(id);
    setCurrent((c) => ({
      id,
      initial: data ? { session: data.session, events: data.events } : {},
      gen: c.gen,
    }));
  }, []);

  const nav = useMemo<NavValue>(
    () => ({ selectedId: current.id, newInvestigation, selectInvestigation }),
    [current.id, newInvestigation, selectInvestigation]
  );

  return (
    <NavContext.Provider value={nav}>
      <EveSession
        initial={current.initial}
        key={current.id ?? `new-${current.gen}`}
        onSaved={() => router.refresh()}
      >
        <SidebarProvider>
          <AppSidebar investigations={investigations} userEmail={userEmail} />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </EveSession>
    </NavContext.Provider>
  );
}
