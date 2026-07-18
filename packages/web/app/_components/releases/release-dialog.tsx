"use client";

import { ExternalLinkIcon, TagIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CopyChip, useOrigin } from "@/app/_components/ui/copy-chip";
import { cutReleaseAction } from "@/app/(chat)/release-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { citationFor, type ReleaseRecord } from "@/lib/release-types";

// Cut and browse releases: named, citable checkpoints of this room's graph.
// The version list doubles as the room's release history; each row hands out
// the public permalink and a ready-to-paste citation.

function ReleaseRow({ release }: { release: ReleaseRecord }) {
  const origin = useOrigin();
  const url = `${origin}/releases/${release.id}`;
  return (
    <div className="rounded-lg border border-border/50 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs">
          <span className="font-medium">v{release.version}</span>
          {release.name ? ` — ${release.name}` : ""}
          <span className="text-muted-foreground">
            {" "}
            · {release.cutoff.slice(0, 10)} · {release.creatorName}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <CopyChip
            label="Citation"
            text={citationFor(release, origin).plain}
          />
          <a
            className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon className="size-3" /> Page
          </a>
        </div>
      </div>
    </div>
  );
}

export function ReleaseDialog({
  open,
  onOpenChange,
  investigation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investigation: string;
}) {
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCut, setJustCut] = useState<ReleaseRecord | null>(null);

  const loadReleases = useCallback(() => {
    fetch(`/api/releases?investigation=${encodeURIComponent(investigation)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { releases: ReleaseRecord[] } | null) => {
        if (body) {
          setReleases(body.releases);
        }
      })
      .catch(() => undefined);
  }, [investigation]);

  useEffect(() => {
    if (open) {
      setError(null);
      setJustCut(null);
      loadReleases();
    }
  }, [open, loadReleases]);

  const cut = () => {
    setBusy(true);
    setError(null);
    cutReleaseAction({ investigationId: investigation, name, notes })
      .then((res) => {
        if ("error" in res) {
          setError(res.error);
        } else {
          setJustCut(res.release);
          setName("");
          setNotes("");
          loadReleases();
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Releases</DialogTitle>
          <DialogDescription>
            A release is a named, citable checkpoint — the graph exactly as it
            stands right now, frozen forever at a public permalink.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {justCut ? (
            <p className="rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-emerald-700 text-xs dark:text-emerald-400">
              <TagIcon className="mr-1 inline size-3" />v{justCut.version} is
              live — grab its citation below.
            </p>
          ) : null}
          {releases.length > 0 ? (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {releases.map((r) => (
                <ReleaseRow key={r.id} release={r} />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              No releases yet — cut v1 below.
            </p>
          )}
          <div className="space-y-3 border-border/40 border-t pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="release-name">Label (optional)</Label>
              <Input
                id="release-name"
                onChange={(e) => setName(e.target.value)}
                placeholder="post-Rootclaim revision"
                value={name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="release-notes">Release notes (optional)</Label>
              <Textarea
                id="release-notes"
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What this version established"
                rows={2}
                value={notes}
              />
            </div>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <div className="flex justify-end">
              <Button disabled={busy} onClick={cut} type="button">
                {busy ? "Cutting…" : `Cut v${(releases[0]?.version ?? 0) + 1}`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
