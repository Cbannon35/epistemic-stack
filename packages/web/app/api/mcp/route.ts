import { createMcpHandler } from "mcp-handler";
import { registerCommonsTools } from "@/lib/mcp/register-tools";

// The commons-wide remote MCP server (streamable HTTP at POST /api/mcp).
// Public and read-only by design: anyone pastes this URL into ChatGPT
// developer mode, a Claude custom connector, or Cursor, and their assistant
// can search the commons and pull claims with receipts. No redisUrl: the
// legacy SSE transport is deliberately not exposed, and the app runs as a
// persistent Node process (withEve), so streamable HTTP needs nothing extra.

const handler = (req: Request) =>
  createMcpHandler(
    (server) =>
      registerCommonsTools(server, {
        origin: new URL(req.url).origin,
        topic: null,
        memberIds: null,
      }),
    {},
    { basePath: "/api", maxDuration: 60 }
  )(req);

export { handler as DELETE, handler as GET, handler as POST };
