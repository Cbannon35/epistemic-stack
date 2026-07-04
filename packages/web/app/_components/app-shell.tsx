"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppSidebar } from "@/app/_components/app-sidebar";
import { NavContext, type NavValue } from "@/app/_components/nav-context";
import { RoomProvider } from "@/app/_components/room-provider";
import {
  getInvestigationRoom,
  type InvestigationRoom,
} from "@/app/(chat)/actions";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import type { InvestigationListItem } from "@/lib/investigations";

// The URL is the room: /i/<sessionId> deep-links into a shared investigation.
// Loaded snapshots are cached per room id so `use()` gets a stable promise;
// evicted when the room unmounts so re-entering refetches fresh state.
const roomCache = new Map<string, Promise<InvestigationRoom | null>>();

function loadRoom(id: string): Promise<InvestigationRoom | null> {
  let promise = roomCache.get(id);
  if (!promise) {
    promise = getInvestigationRoom(id);
    roomCache.set(id, promise);
  }
  return promise;
}

function RoomLoading() {
  return (
    <div className="flex h-dvh w-full items-center justify-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

function RoomNotFound() {
  return (
    <main className="flex h-dvh w-full flex-col items-center justify-center gap-2">
      <p className="text-muted-foreground text-sm">
        This investigation doesn't exist (or was never started).
      </p>
      <Link
        className="text-sm underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
        href="/"
      >
        Start a new one
      </Link>
    </main>
  );
}

function RoomBoot({
  roomId,
  forkFrom,
  me,
  onSessionStart,
  onSaved,
  children,
}: {
  roomId: string | null;
  forkFrom: string | null;
  me: { userId: string; displayName: string };
  onSessionStart: (sessionId: string) => void;
  onSaved: () => void;
  children: ReactNode;
}) {
  // Suspends on deep link / room switch; instant for new rooms.
  const initial = roomId ? use(loadRoom(roomId)) : null;

  // Evict on unmount so revisiting this room loads the latest snapshot.
  useEffect(
    () => () => {
      if (roomId) {
        roomCache.delete(roomId);
      }
    },
    [roomId]
  );

  if (roomId && !initial) {
    return <RoomNotFound />;
  }
  return (
    <RoomProvider
      forkFrom={forkFrom}
      initial={initial}
      me={me}
      onSaved={onSaved}
      onSessionStart={onSessionStart}
      roomId={roomId}
    >
      {children}
    </RoomProvider>
  );
}

export function AppShell({
  user,
  investigations,
  children,
}: {
  user: { id: string; email: string | null };
  investigations: InvestigationListItem[];
  children: ReactNode;
}) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const search = useSearchParams();
  const routeId = typeof params.id === "string" ? params.id : null;
  const forkFrom = routeId ? null : search.get("fork");
  const [gen, setGen] = useState(0);
  // Set when a NEW room gets its server-assigned id: the URL flips to /i/<id>
  // via replaceState, and this guard keeps the live streaming room mounted
  // instead of remounting it as a "resume".
  const [liveId, setLiveId] = useState<string | null>(null);

  // Invalidate the live guard on real navigation away (location.pathname is
  // updated synchronously, unlike useParams, so the post-first-send window
  // where params lag the replaceState never trips this).
  // biome-ignore lint/correctness/useExhaustiveDependencies: routeId is the navigation signal; the effect reads location.pathname (sync) to avoid the params lag
  useEffect(() => {
    if (!liveId) {
      return;
    }
    const path = window.location.pathname;
    const urlId = path.startsWith("/i/")
      ? decodeURIComponent(path.slice(3))
      : null;
    if (urlId !== liveId) {
      setLiveId(null);
      setGen((g) => g + 1);
    }
  }, [liveId, routeId]);

  const newInvestigation = useCallback(() => {
    setLiveId(null);
    setGen((g) => g + 1);
    router.push("/");
  }, [router]);

  const onSessionStart = useCallback((sessionId: string) => {
    setLiveId(sessionId);
    window.history.replaceState(
      null,
      "",
      `/i/${encodeURIComponent(sessionId)}`
    );
  }, []);

  const nav = useMemo<NavValue>(
    () => ({ newInvestigation }),
    [newInvestigation]
  );

  const me = useMemo(
    () => ({
      userId: user.id,
      displayName: user.email?.split("@")[0] || "anonymous",
    }),
    [user.id, user.email]
  );

  const isLive = routeId !== null && routeId === liveId;
  const mountKey = routeId && !isLive ? routeId : `new-${gen}`;

  return (
    <NavContext.Provider value={nav}>
      <Suspense fallback={<RoomLoading />}>
        <RoomBoot
          forkFrom={forkFrom}
          key={mountKey}
          me={me}
          onSaved={() => router.refresh()}
          onSessionStart={onSessionStart}
          roomId={isLive ? null : routeId}
        >
          <SidebarProvider>
            <AppSidebar investigations={investigations} me={me} />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
        </RoomBoot>
      </Suspense>
    </NavContext.Provider>
  );
}
