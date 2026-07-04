import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordHypothesis } from "../lib/commons.ts";

// Record a competing explanation for the question. Do this early (after scouting)
// so claims can be attached to the rival answers.
export default defineTool({
  description:
    'Record a competing explanation (hypothesis) for the question — e.g. "SARS-CoV-2 escaped a Wuhan lab" vs "natural zoonotic spillover". Returns a hypothesis_id to link claims to with link_claim_to_hypothesis.',
  inputSchema: z.object({
    statement: z
      .string()
      .min(1)
      .describe("The explanation, as a standalone statement."),
    answer_bearing: z
      .string()
      .optional()
      .describe(
        'Which answer it supports, e.g. "yes" / "no" for a yes/no question.'
      ),
  }),
  async execute({ statement, answer_bearing }, ctx) {
    const { id } = await recordHypothesis({
      statement,
      answerBearing: answer_bearing,
      sessionId: ctx?.session?.id,
    });
    return { hypothesis_id: id };
  },
});
