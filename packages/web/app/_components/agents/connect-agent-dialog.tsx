"use client";

import { BotIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CopyChip, useOrigin } from "@/app/_components/ui/copy-chip";
import {
  listAgentKeysAction,
  mintAgentKeyAction,
  revokeAgentKeyAction,
} from "@/app/(chat)/agent-actions";
import { formatDate } from "@/app/topics/_components/stat-tile";
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

function MintedPane({
  token,
  name,
  onDone,
}: {
  token: string;
  name: string;
  onDone: () => void;
}) {
  const origin = useOrigin();
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
      {/* The pane replaces the key list outright, so without this the only way
          out is the window chrome's ✕. */}
      <div className="flex justify-end border-border/40 border-t pt-3">
        <Button onClick={onDone} type="button" variant="outline">
          Done
        </Button>
      </div>
    </div>
  );
}

function agentStatus(agent: AgentKeyListItem): string {
  if (agent.revokedAt !== null) {
    return "revoked";
  }
  return agent.lastUsedAt
    ? `last active ${formatDate(agent.lastUsedAt)}`
    : "never used";
}

// Two lines, matching the release dialog: name and status on one truncating
// line loses the status first (it sorts last) as soon as the name is long.
function AgentRow({
  agent,
  onRevoke,
}: {
  agent: AgentKeyListItem;
  onRevoke: (id: string) => void;
}) {
  const revoked = agent.revokedAt !== null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <BotIcon className="size-3 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p
            className={`truncate font-medium text-xs ${revoked ? "text-muted-foreground line-through" : ""}`}
          >
            {agent.name}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {agentStatus(agent)}
          </p>
        </div>
      </div>
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
      <DialogContent className="sm:max-w-lg">
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
          <MintedPane
            name={minted.name}
            onDone={() => setMinted(null)}
            token={minted.token}
          />
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
