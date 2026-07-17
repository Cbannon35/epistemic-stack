"use client";

import { useEffect, useState } from "react";
import { openMergeRequestAction } from "@/app/(chat)/merge-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MergeDiffCounts } from "@/lib/merge-types";

// Propose merging this fork back into its parent: shows the live diff (what
// the parent would adopt) and files the request for the parent owner's
// review. GitHub PR, translated to scope adoption.

export function ProposeMergeDialog({
  open,
  onOpenChange,
  sourceId,
  targetId,
  onProposed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  targetId: string;
  onProposed: () => void;
}) {
  const [counts, setCounts] = useState<MergeDiffCounts | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setDone(false);
    setCounts(null);
    let cancelled = false;
    fetch(
      `/api/merge/diff?source=${encodeURIComponent(sourceId)}&target=${encodeURIComponent(targetId)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { counts: MergeDiffCounts } | null) => {
        if (!cancelled && d) {
          setCounts(d.counts);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, sourceId, targetId]);

  const propose = () => {
    setBusy(true);
    setError(null);
    openMergeRequestAction({ sourceId, targetId, note })
      .then((res) => {
        if ("error" in res) {
          setError(res.error);
        } else {
          setDone(true);
          onProposed();
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propose a merge</DialogTitle>
          <DialogDescription>
            Ask the parent investigation to adopt this fork's work into its
            visible scope. Nothing is copied or lost — the fork stays a room of
            its own.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="text-sm">
            Merge request opened — the parent room's owner can review it from
            their graph toolbar's <span className="font-medium">merges</span>{" "}
            panel.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs">
              {counts
                ? `The parent would adopt ${counts.incoming} new node${
                    counts.incoming === 1 ? "" : "s"
                  } (${counts.shared} already shared).`
                : "Computing what the parent would adopt…"}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="merge-note">Why merge this?</Label>
              <Textarea
                id="merge-note"
                onChange={(e) => setNote(e.target.value)}
                placeholder="What this branch established and why it belongs upstream"
                rows={3}
                value={note}
              />
            </div>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <div className="flex justify-end">
              <Button disabled={busy} onClick={propose} type="button">
                {busy ? "Opening…" : "Open merge request"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
