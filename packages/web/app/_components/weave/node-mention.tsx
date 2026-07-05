"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphData } from "@/app/_components/graph/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { type NodeRefKind, nodeRefToken } from "./node-ref";

// Typing `#` at a word boundary in the chat composer opens this picker over
// the room's graph nodes; selecting swaps the typed `#` for a plain-text
// reference token. The textarea stays uncontrolled — we edit its value
// directly and dispatch an `input` event so field-sizing keeps up.

type PickerNode = { id: string; kind: NodeRefKind; label: string };

const KIND_HINT: Record<string, string> = {
  claim: "claim",
  source: "source",
  crux: "crux",
  hypothesis: "hyp",
};

export function NodeMentionPicker({
  containerRef,
  roomId,
}: {
  /** Wrapper around the PromptInput — used to find the message textarea. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  roomId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [nodes, setNodes] = useState<PickerNode[] | null>(null);
  const hashIndexRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Arm on `#` typed at a word boundary (start of text or after whitespace).
  useEffect(() => {
    const textarea = containerRef.current?.querySelector<HTMLTextAreaElement>(
      'textarea[name="message"]'
    );
    if (!textarea) {
      return;
    }
    textareaRef.current = textarea;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== "#" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.isComposing
      ) {
        return;
      }
      const caret = textarea.selectionStart ?? textarea.value.length;
      const before = caret > 0 ? textarea.value[caret - 1] : " ";
      if (!/\s/.test(before)) {
        return;
      }
      // Let the `#` land in the textarea, then open over it.
      hashIndexRef.current = caret;
      setOpen(true);
    };
    textarea.addEventListener("keydown", onKeyDown);
    return () => textarea.removeEventListener("keydown", onKeyDown);
  }, [containerRef]);

  // Load the room-scoped node catalog when the picker opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    setNodes(null);
    const url = roomId
      ? `/api/graph?investigation=${encodeURIComponent(roomId)}`
      : "/api/graph";
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<GraphData>) : null))
      .then((data) => {
        if (cancelled || !data) {
          setNodes((prev) => prev ?? []);
          return;
        }
        setNodes(
          data.nodes.map((n) => ({
            id: n.id,
            kind: n.kind as NodeRefKind,
            label: n.label,
          }))
        );
      })
      .catch(() => setNodes([]));
    return () => {
      cancelled = true;
    };
  }, [open, roomId]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      textareaRef.current?.focus();
    }
  }, []);

  // Click outside dismisses (leaving the typed `#` in place).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) {
        close(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const insert = (node: PickerNode) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      close(false);
      return;
    }
    const token = `${nodeRefToken(node.kind, node.id, node.label)} `;
    const value = textarea.value;
    const at = hashIndexRef.current;
    // Replace the `#` that opened the picker; if the text shifted under us,
    // fall back to appending at the end.
    const anchored = value[at] === "#";
    const start = anchored ? at : value.length;
    const end = anchored ? at + 1 : value.length;
    textarea.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
    const caret = start + token.length;
    textarea.setSelectionRange(caret, caret);
    // Uncontrolled textarea: notify listeners (field-sizing, drafts).
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    close(true);
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fade-in absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-lg border border-border/60 bg-background/95 shadow-[var(--shadow-float)] backdrop-blur"
      ref={panelRef}
    >
      <Command className="bg-transparent">
        <CommandInput
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close(true);
            }
          }}
          placeholder="Reference a node from the graph…"
        />
        <CommandList className="max-h-52">
          <CommandEmpty className="p-3 text-muted-foreground text-xs">
            {nodes === null ? "loading the graph…" : "no matching nodes"}
          </CommandEmpty>
          <CommandGroup>
            {(nodes ?? []).map((node) => (
              <CommandItem
                className="text-xs"
                key={node.id}
                onSelect={() => insert(node)}
                value={`${node.label} ${node.id}`}
              >
                <span className="w-11 shrink-0 text-[9px] text-muted-foreground uppercase">
                  {KIND_HINT[node.kind] ?? node.kind}
                </span>
                <span className="line-clamp-2">{node.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
