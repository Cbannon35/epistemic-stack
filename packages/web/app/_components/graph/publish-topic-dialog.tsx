"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  previewTopicAction,
  publishTopicAction,
} from "@/app/(chat)/topic-actions";
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
import type { TopicStats } from "@/lib/topics";

// Publish the current commons view as a topic slice: name it, keep the seed
// query, preview what it captures right now, and get back a public page +
// MCP connector URL. The slice keeps growing after publish — that's the point.

const PREVIEW_DEBOUNCE_MS = 400;
const NON_ALNUM = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

function slugHint(name: string): string {
  return name.toLowerCase().replace(NON_ALNUM, "-").replace(EDGE_DASHES, "");
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      aria-label="Copy"
      className="flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
      type="button"
    >
      {copied ? (
        <CheckIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function PreviewLine({
  stats,
  pending,
}: {
  stats: TopicStats | null;
  pending: boolean;
}) {
  if (pending) {
    return (
      <p className="text-muted-foreground text-xs">Checking the commons…</p>
    );
  }
  if (!stats) {
    return (
      <p className="text-muted-foreground text-xs">
        Type a seed query to preview what this topic captures.
      </p>
    );
  }
  if (stats.claims + stats.hypotheses + stats.sources === 0) {
    return (
      <p className="text-destructive text-xs">
        That seed query matches nothing in the commons yet.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-xs">
      Captures ~{stats.claims} claims · {stats.sources} sources ·{" "}
      {stats.hypotheses} hypotheses right now — and grows as the commons grows.
    </p>
  );
}

function PublishedPane({ slug }: { slug: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const pageUrl = `${origin}/topics/${slug}`;
  const mcpUrl = `${origin}/api/mcp/${slug}/mcp`;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Published! The slice is live on the public gallery and keeps growing
        with the commons.
      </p>
      <a
        className="flex items-center gap-1.5 text-sm underline underline-offset-4"
        href={pageUrl}
        rel="noreferrer"
        target="_blank"
      >
        View the topic page <ExternalLinkIcon className="size-3.5" />
      </a>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">
          MCP connector URL — paste into ChatGPT, Claude, or Cursor:
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
            {mcpUrl}
          </code>
          <CopyChip text={mcpUrl} />
        </div>
      </div>
    </div>
  );
}

export function PublishTopicDialog({
  open,
  onOpenChange,
  seedQuery: initialSeedQuery,
  pinnedClaimIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seedQuery: string;
  pinnedClaimIds?: string[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [seedQuery, setSeedQuery] = useState(initialSeedQuery);
  const [stats, setStats] = useState<TopicStats | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);

  // Re-seed from the commons search bar each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSeedQuery(initialSeedQuery);
      setError(null);
      setPublishedSlug(null);
    }
  }, [open, initialSeedQuery]);

  // Debounced live preview of what the recipe captures.
  useEffect(() => {
    if (!open) {
      return;
    }
    const trimmed = seedQuery.trim();
    if (!trimmed) {
      setStats(null);
      return;
    }
    setPreviewPending(true);
    const t = setTimeout(() => {
      previewTopicAction(trimmed, pinnedClaimIds)
        .then((res) => setStats(res.ok ? (res.stats ?? null) : null))
        .finally(() => setPreviewPending(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, seedQuery, pinnedClaimIds]);

  const captures = stats ? stats.claims + stats.hypotheses + stats.sources : 0;
  const canPublish =
    !publishing && name.trim().length > 0 && captures > 0 && !previewPending;

  const publish = () => {
    setPublishing(true);
    setError(null);
    publishTopicAction({ name, description, seedQuery, pinnedClaimIds })
      .then((res) => {
        if (res.ok) {
          setPublishedSlug(res.slug);
        } else {
          setError(res.error);
        }
      })
      .finally(() => setPublishing(false));
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish a topic slice</DialogTitle>
          <DialogDescription>
            A living export of the commons around a seed query — public page,
            JSON download, and its own MCP connector.
          </DialogDescription>
        </DialogHeader>
        {publishedSlug ? (
          <PublishedPane slug={publishedSlug} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="topic-name">Name</Label>
              <Input
                id="topic-name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Seed oils and inflammation"
                value={name}
              />
              {name.trim() ? (
                <p className="text-[11px] text-muted-foreground">
                  /topics/{slugHint(name)}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic-description">Description</Label>
              <Textarea
                id="topic-description"
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this slice covers and why it matters"
                rows={2}
                value={description}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic-seed">Seed query</Label>
              <Input
                id="topic-seed"
                onChange={(e) => setSeedQuery(e.target.value)}
                placeholder="the search that defines this topic"
                value={seedQuery}
              />
              <PreviewLine pending={previewPending} stats={stats} />
            </div>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <div className="flex justify-end">
              <Button disabled={!canPublish} onClick={publish} type="button">
                {publishing ? "Publishing…" : "Publish to the gallery"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
