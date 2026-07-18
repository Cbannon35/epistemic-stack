import { createMcpHandler } from "mcp-handler";
import { NextResponse } from "next/server";
import { resolveAgentToken } from "@/lib/agent-keys";
import { registerAgentCollabTools } from "@/lib/mcp/register-agent-collab-tools";
import { registerAgentTools } from "@/lib/mcp/register-agent-tools";
import { registerCommonsTools } from "@/lib/mcp/register-tools";

// The write-capable agent MCP server: POST /api/mcp/agent/mcp with
// `Authorization: Bearer esk_…` (minted from the sidebar's "Connect an
// agent"). Authenticated agents get the full read surface PLUS write tools,
// acting as their own contributor — a multiplayer participant, not a feed.

const handler = async (req: Request) => {
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const agent = bearer ? await resolveAgentToken(bearer) : null;
  if (!agent) {
    return NextResponse.json(
      {
        error:
          "agent key required — mint one from the app sidebar's “Connect an agent” and send it as a Bearer token",
      },
      { status: 401 }
    );
  }
  const origin = new URL(req.url).origin;
  const scope = { origin, agent };
  return createMcpHandler(
    (server) => {
      registerCommonsTools(server, { origin, topic: null, memberIds: null });
      registerAgentTools(server, scope);
      registerAgentCollabTools(server, scope);
    },
    {},
    { basePath: "/api/mcp/agent", maxDuration: 60 }
  )(req);
};

export { handler as DELETE, handler as GET, handler as POST };
