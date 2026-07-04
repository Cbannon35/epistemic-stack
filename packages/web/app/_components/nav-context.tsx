"use client";

import { createContext, useContext } from "react";

// Which investigation is open + how to switch — lifted client state shared by the
// sidebar and the session shell (not the URL, which doesn't re-render reliably
// from a layout).
export type NavValue = {
  selectedId: string | null;
  newInvestigation: () => void;
  selectInvestigation: (id: string) => void;
};

export const NavContext = createContext<NavValue | null>(null);

export function useNav(): NavValue {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error("useNav must be used within AppShell");
  }
  return ctx;
}
