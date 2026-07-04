import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordClaim } from "../lib/commons.ts";

// Extract one standalone claim into the commons. Embeds it and dedups against
// existing claims: if it restates something already there, the mention attaches
// to that canonical claim (a re-find that drives coverage), otherwise a new
// claim node is created. Always records the verbatim source quote (the receipt).
export default defineTool({
  description:
    "Record ONE standalone claim, tied to a source and a verbatim quote. The commons embeds and dedups it automatically — if it restates an existing claim, they merge (returns is_new=false with the similarity). Only record what the quote actually supports.",
  inputSchema: z.object({
    claim: z
      .string()
      .min(1)
      .describe("A single, standalone assertion (not a paragraph)."),
    source_id: z.string().min(1).describe("From record_source."),
    quote: z
      .string()
      .min(1)
      .describe("The verbatim span from the source that supports this claim."),
    discipline: z.string().optional(),
    position: z
      .string()
      .optional()
      .describe("Which side/stance this claim supports, if any."),
    evidence_type: z
      .string()
      .optional()
      .describe("e.g. empirical, testimony, modeling, review."),
    era: z.string().optional(),
  }),
  async execute(
    { claim, source_id, quote, discipline, position, evidence_type, era },
    ctx
  ) {
    const result = await recordClaim({
      text: claim,
      sourceId: source_id,
      quote,
      descriptors: { discipline, position, evidence_type, era },
      sessionId: ctx?.session?.id,
    });
    return {
      claim_id: result.canonicalId,
      is_new: result.isNew,
      merged_similarity: result.mergedSimilarity,
    };
  },
});
