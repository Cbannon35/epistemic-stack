import { defineTool } from "eve/tools";
import { z } from "zod";
import { addSource } from "../lib/commons.ts";

// Store a source in the commons (content-addressed; the same text resolves to
// one row). Returns the source_id to pass to record_claim.
export default defineTool({
  description:
    "Record a source you are about to cite in the commons. Pass its identifying text (abstract or key passage) plus metadata. Returns a source_id to use with record_claim.",
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .describe(
        "The source text you read (abstract or key passage) — used to content-address it."
      ),
    title: z.string().optional(),
    url: z.string().optional(),
    author: z.string().optional(),
    venue: z.string().optional().describe("Publisher or journal."),
    date: z.string().optional().describe("Publication date or year."),
    peer_reviewed: z.boolean().optional(),
  }),
  async execute({ text, title, url, author, venue, date, peer_reviewed }, ctx) {
    const sourceId = await addSource({
      text,
      title,
      url,
      author,
      publisher: venue,
      date,
      guarantees: peer_reviewed === undefined ? undefined : { peer_reviewed },
      retrieval: { retriever: "openalex" },
      sessionId: ctx?.session?.id,
    });
    return { source_id: sourceId };
  },
});
