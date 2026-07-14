"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

// The topic page's "add this to your assistant" card. The connector URL needs
// the deployed origin, which only the browser reliably knows (the pages are
// statically revalidated), so it's assembled after mount.

function CopyButton({ text, label }: { text: string; label: string }) {
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
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted hover:text-foreground"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
      type="button"
    >
      {copied ? (
        <>
          <CheckIcon className="size-3" /> Copied
        </>
      ) : (
        <>
          <CopyIcon className="size-3" /> Copy
        </>
      )}
    </button>
  );
}

export function ConnectCard({ slug }: { slug: string }) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const url = `${origin ?? ""}/api/mcp/${slug}/mcp`;
  const config = JSON.stringify(
    { mcpServers: { [`epistack-${slug}`]: { url } } },
    null,
    2
  );
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-background p-4 shadow-[var(--shadow-card)]">
      <div>
        <h2 className="font-medium text-sm">Connect your AI assistant</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          This topic is a live MCP server. Paste the URL into ChatGPT (developer
          mode), Claude (custom connectors), Cursor, or any MCP client — the
          assistant can then search these claims, pull evidence with receipts,
          and cite the commons.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
          {url}
        </code>
        <CopyButton label="Copy connector URL" text={url} />
      </div>
      <details className="group">
        <summary className="cursor-pointer text-muted-foreground text-xs transition-colors hover:text-foreground">
          Client config snippet
        </summary>
        <div className="mt-2 flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] leading-relaxed">
            {config}
          </pre>
          <CopyButton label="Copy client config" text={config} />
        </div>
      </details>
    </div>
  );
}
