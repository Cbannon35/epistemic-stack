"use client";

import { LockIcon, MessageSquarePlusIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  anchorFromSelection,
  type CommentAnchor,
} from "@/app/_components/comments/anchor";
import { useComments } from "@/app/_components/comments/use-comments";

type Pending = {
  anchor: CommentAnchor;
  rect: { left: number; top: number; bottom: number; width: number };
};

const toolbarButton =
  "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] active:bg-muted";

// Medium-style selection toolbar: select text in a message → a floating pill
// offers a public comment or a private note; picking one opens a small
// composer at the same spot. Position is fixed (viewport coords from the
// selection rect) — scrolling collapses the selection, which hides it.
export function SelectionToolbar() {
  const { add } = useComments();
  const [pending, setPending] = useState<Pending | null>(null);
  const [composer, setComposer] = useState<"public" | "private" | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const close = useCallback(() => {
    setPending(null);
    setComposer(null);
    setBody("");
    setSaving(false);
  }, []);

  // Read the selection after pointer/keyboard selection settles.
  useEffect(() => {
    const readSelection = (event: Event) => {
      // Don't clobber an open composer, and ignore events inside our own UI.
      if (composer) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-comments-ui]")) {
        return;
      }
      setTimeout(() => {
        const selection = window.getSelection();
        const found = selection ? anchorFromSelection(selection) : null;
        if (found) {
          setPending({
            anchor: found.anchor,
            rect: {
              left: found.rect.left,
              top: found.rect.top,
              bottom: found.rect.bottom,
              width: found.rect.width,
            },
          });
        } else {
          setPending(null);
        }
      }, 0);
    };
    document.addEventListener("pointerup", readSelection);
    document.addEventListener("keyup", readSelection);
    return () => {
      document.removeEventListener("pointerup", readSelection);
      document.removeEventListener("keyup", readSelection);
    };
  }, [composer]);

  useEffect(() => {
    if (composer) {
      textareaRef.current?.focus();
    }
  }, [composer]);

  const submit = async () => {
    if (!(pending && composer) || !body.trim() || saving) {
      return;
    }
    setSaving(true);
    await add({
      body,
      visibility: composer,
      anchor: pending.anchor,
    });
    window.getSelection()?.removeAllRanges();
    close();
  };

  if (!pending) {
    return null;
  }

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.max(8, pending.rect.left + pending.rect.width / 2 - 90),
    top: pending.rect.bottom + 8,
    zIndex: 60,
  };

  return (
    <div data-comments-ui style={style}>
      {composer ? (
        <div className="fade-up w-72 rounded-lg border border-border/60 bg-popover p-2 shadow-[var(--shadow-float)]">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            {composer === "private" ? (
              <>
                <LockIcon className="size-3" /> private note — only you see it
              </>
            ) : (
              <>on “{pending.anchor.quote.slice(0, 60)}…”</>
            )}
          </p>
          <textarea
            className="h-16 w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            placeholder={
              composer === "private"
                ? "Note to self…"
                : "Comment… (@eve works in replies)"
            }
            ref={textareaRef}
            value={body}
          />
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <button
              className="cursor-pointer rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
              onClick={close}
              type="button"
            >
              cancel
            </button>
            <button
              className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-[11px] text-primary-foreground transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
              disabled={!body.trim() || saving}
              onClick={submit}
              type="button"
            >
              {saving
                ? "saving…"
                : composer === "private"
                  ? "Save note"
                  : "Comment"}
            </button>
          </div>
        </div>
      ) : (
        <div className="fade-up flex items-center gap-0.5 rounded-lg border border-border/60 bg-popover p-0.5 shadow-[var(--shadow-float)]">
          <button
            className={toolbarButton}
            onClick={() => setComposer("public")}
            type="button"
          >
            <MessageSquarePlusIcon className="size-3.5" />
            Comment
          </button>
          <span className="h-4 w-px bg-border/60" />
          <button
            className={`${toolbarButton} text-muted-foreground`}
            onClick={() => setComposer("private")}
            title="A note only you can see"
            type="button"
          >
            <LockIcon className="size-3.5" />
            Note
          </button>
        </div>
      )}
    </div>
  );
}
