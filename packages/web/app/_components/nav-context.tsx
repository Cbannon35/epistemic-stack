"use client";

import { createContext, useContext } from "react";

// Room selection lives in the URL (/i/<id>); the only nav action left is
// starting a fresh investigation (which also busts the live-room guard).
export type NavValue = {
  newInvestigation: () => void;
};

export const NavContext = createContext<NavValue | null>(null);

export function useNav(): NavValue {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error("useNav must be used within AppShell");
  }
  return ctx;
}
