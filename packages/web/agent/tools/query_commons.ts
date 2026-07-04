import { defineTool } from "eve/tools";
import { z } from "zod";
import { queryClaims } from "../lib/commons.ts";

// Semantic search over claims already in the commons. Use this BEFORE
// extracting, so you build on prior investigations (compounding) and see what
// is already known rather than re-deriving it.
export default defineTool({
  description:
    "Search claims already in the commons by meaning. Call this early and often: it shows what prior work already established, so you extend the graph instead of duplicating it.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("What you want to know if the commons already covers."),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  async execute({ query, limit }) {
    const matches = await queryClaims(query, limit);
    return {
      matches: matches.map((m) => ({
        claim_id: m.id,
        text: m.text,
        similarity: Number(m.similarity.toFixed(3)),
      })),
    };
  },
});
