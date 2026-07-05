import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordCrux } from "../lib/commons.ts";

// Record an open "what would change our mind" question tied to a claim. An
// unanswered crux on a load-bearing claim is itself a finding — it names the
// residual uncertainty.
export default defineTool({
  description:
    "Record a crux: an open question tied to a claim (by claim_id) whose answer would change our confidence in it. Use after pressure-testing load-bearing claims.",
  inputSchema: z.object({
    claim_id: z.string().min(1),
    question: z
      .string()
      .min(1)
      .describe("The concrete, researchable question."),
    implication: z
      .string()
      .optional()
      .describe("What a yes/no answer would do to the picture."),
  }),
  async execute({ claim_id, question, implication }, ctx) {
    const result = await recordCrux({
      claimId: claim_id,
      question,
      implication,
      sessionId: ctx?.session?.id,
      turnId: ctx?.session?.turn?.id,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, crux_id: result.cruxId, claim_id, question };
  },
});
