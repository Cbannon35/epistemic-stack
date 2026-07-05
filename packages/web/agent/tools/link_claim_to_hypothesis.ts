import { defineTool } from "eve/tools";
import { z } from "zod";
import { linkClaimToHypothesis } from "../lib/commons.ts";

// Attach a claim to a hypothesis: does it support or undermine that explanation,
// and how much does it discriminate it from the rivals (diagnosticity)?
export default defineTool({
  description:
    "Link a claim (by claim_id) to a hypothesis (by hypothesis_id): whether the claim supports or undermines it, and its diagnosticity (0..1 — how strongly it discriminates this hypothesis from the others; a claim consistent with every hypothesis is ~0.1, one true only under this hypothesis is ~0.9). Judge what the claim implies IF true, not whether it is true.",
  inputSchema: z.object({
    claim_id: z.string().min(1),
    hypothesis_id: z.string().min(1),
    polarity: z.enum(["supports", "undermines"]),
    diagnosticity: z.number().min(0).max(1).optional(),
  }),
  async execute({ claim_id, hypothesis_id, polarity, diagnosticity }, ctx) {
    const result = await linkClaimToHypothesis({
      claimId: claim_id,
      hypothesisId: hypothesis_id,
      polarity,
      diagnosticity,
      sessionId: ctx?.session?.id,
      turnId: ctx?.session?.turn?.id,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, claim_id, hypothesis_id, polarity };
  },
});
