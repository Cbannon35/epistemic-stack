"use client";

import { BotIcon, CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  listAgentKeysAction,
  mintAgentKeyAction,
  revokeAgentKeyAction,
} from "@/app/(chat)/agent-actions";
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
import type { AgentKeyListItem } from "@/lib/agent-keys";

// Mint bearer keys that let external agents join the commons as first-class
// multiplayer contributors over MCP — reading, writing, believing, and
// disputing under their own identity. The token shows exactly once.

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

function MintedPane({ token, name }: { token: string; name: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const mcpUrl = `${origin}/api/mcp/agent/mcp`;
  const config = JSON.stringify(
    {
      mcpServers: {
        [name.toLowerCase().replace(/\s+/g, "-")]: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2
  );
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium">{name}</span> can now join investigations.
        This key shows <span className="font-medium">once</span> — copy it now.
      </p>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">Agent key</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
            {token}
          </code>
          <CopyChip text={token} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">
          MCP endpoint (send the key as a Bearer token)
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
            {mcpUrl}
          </code>
          <CopyChip text={mcpUrl} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-muted-foreground text-xs">
          Client config (Claude Code, Cursor, …)
        </p>
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-[10px] leading-relaxed">
            {config}
          </pre>
          <CopyChip text={config} />
        </div>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  onRevoke,
}: {
  agent: AgentKeyListItem;
  onRevoke: (id: string) => void;
}) {
  const revoked = agent.revokedAt !== null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2.5 py-2">
      <p className="min-w-0 truncate text-xs">
        <BotIcon className="mr-1 inline size-3 text-muted-foreground" />
        <span className={revoked ? "line-through" : ""}>{agent.name}</span>
        <span className="text-muted-foreground">
          {" "}
          ·{" "}
          {revoked
            ? "revoked"
            : agent.lastUsedAt
              ? `active ${agent.lastUsedAt.slice(0, 10)}`
              : "never used"}
        </span>
      </p>
      {revoked ? null : (
        <button
          className="shrink-0 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={() => onRevoke(agent.id)}
          type="button"
        >
          Revoke
        </button>
      )}
    </div>
  );
}

export function ConnectAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [agents, setAgents] = useState<AgentKeyListItem[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ token: string; name: string } | null>(
    null
  );

  const refresh = useCallback(() => {
    listAgentKeysAction()
      .then(setAgents)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (open) {
      setMinted(null);
      setError(null);
      refresh();
    }
  }, [open, refresh]);

  const mint = () => {
    setBusy(true);
    setError(null);
    mintAgentKeyAction({ name })
      .then((res) => {
        if ("error" in res) {
          setError(res.error);
        } else {
          setMinted({ token: res.token, name: res.name });
          setName("");
          refresh();
        }
      })
      .finally(() => setBusy(false));
  };

  const revoke = (id: string) => {
    revokeAgentKeyAction({ id }).then(refresh);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect an agent</DialogTitle>
          <DialogDescription>
            Give an external agent (Claude Code, ChatGPT, Cursor, your own bot…)
            a key to join investigations as a contributor — recording claims,
            registering beliefs, and filing challenges under its own name, live
            in everyone's rooms.
          </DialogDescription>
        </DialogHeader>
        {minted ? (
          <MintedPane name={minted.name} token={minted.token} />
        ) : (
          <div className="space-y-4">
            {agents.length > 0 ? (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {agents.map((a) => (
                  <AgentRow agent={a} key={a.id} onRevoke={revoke} />
                ))}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">Agent name</Label>
              <Input
                id="agent-name"
                onChange={(e) => setName(e.target.value)}
                placeholder="scout-1"
                value={name}
              />
            </div>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <div className="flex justify-end">
              <Button
                disabled={busy || name.trim().length === 0}
                onClick={mint}
                type="button"
              >
                {busy ? "Minting…" : "Mint agent key"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
