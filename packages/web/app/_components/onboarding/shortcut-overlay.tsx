"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// `?` from anywhere (outside inputs) → the room's keyboard/verb reference.
// Documents only what actually exists — update alongside new bindings.

const SHORTCUTS: Array<{ keys: string; where: string; does: string }> = [
  { keys: "/", where: "graph", does: "chat at your cursor, Figma-style" },
  {
    keys: "@eve <question>",
    where: "cursor chat",
    does: "eve answers on the spot — or walks the whole room through the graph",
  },
  {
    keys: "@eve investigate <brief>",
    where: "cursor chat",
    does: "delegate a background investigation (also: the Delegate button)",
  },
  { keys: "Esc", where: "graph", does: "stop your tour · close cursor chat" },
  { keys: "⌘ K", where: "anywhere", does: "search the whole commons" },
  { keys: "Enter", where: "composer", does: "send" },
  {
    keys: "highlight text",
    where: "chat",
    does: "comment publicly, or keep a private note",
  },
  { keys: "?", where: "anywhere", does: "this reference" },
];

export function ShortcutOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Around the room</DialogTitle>
          <DialogDescription className="text-xs">
            The verbs and keys this workspace answers to.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div className="flex items-baseline gap-2 text-xs" key={s.keys}>
              <code className="shrink-0 rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-medium text-[10px] text-foreground">
                {s.keys}
              </code>
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">
                {s.where}
              </span>
              <span className="text-muted-foreground">{s.does}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
