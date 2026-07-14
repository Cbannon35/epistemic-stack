import { createMcpHandler } from "mcp-handler";
import { NextResponse } from "next/server";
import { registerCommonsTools } from "@/lib/mcp/register-tools";
import { resolveTopicSlice } from "@/lib/topics";

// Per-topic MCP servers — the connector URL each gallery card hands out:
// POST /api/mcp/<slug>/mcp (the trailing /mcp is the transport segment
// mcp-handler dispatches on). The slice is resolved once per request and
// closed over, so every tool answers within that topic's membership.

const handler = async (
  req: Request,
  { params }: { params: Promise<{ slug: string; transport: string }> }
) => {
  const { slug } = await params;
  const resolved = await resolveTopicSlice(slug);
  if (!resolved) {
    return NextResponse.json({ error: "unknown topic" }, { status: 404 });
  }
  const memberIds = new Set(resolved.graph.nodes.map((n) => n.id));
  return createMcpHandler(
    (server) =>
      registerCommonsTools(server, {
        origin: new URL(req.url).origin,
        topic: resolved.topic,
        memberIds,
      }),
    {},
    { basePath: `/api/mcp/${slug}`, maxDuration: 60 }
  )(req);
};

export { handler as DELETE, handler as GET, handler as POST };
