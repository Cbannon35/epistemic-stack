import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordRelation } from "../lib/commons.ts";

// Record a typed edge between two claims already in the commons — this is what
// turns a pile of claims into an argument map (what supports/contradicts what).
export default defineTool({
  description:
    "Record a relationship between two existing claims (by claim_id). Use after recording claims to build the argument structure: which claims support, contradict, depend on, or refine which.",
  inputSchema: z.object({
    from_claim_id: z.string().min(1),
    to_claim_id: z.string().min(1),
    type: z.enum(["supports", "contradicts", "depends_on", "refines"]),
    rationale: z.string().optional().describe("Why this relationship holds."),
  }),
  async execute({ from_claim_id, to_claim_id, type, rationale }, ctx) {
    const result = await recordRelation({
      fromClaimId: from_claim_id,
      toClaimId: to_claim_id,
      type,
      rationale,
      sessionId: ctx?.session?.id,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, from: from_claim_id, to: to_claim_id, type };
  },
});
