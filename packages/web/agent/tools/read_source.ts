import { defineTool } from "eve/tools";
import { z } from "zod";
import { addSource } from "../lib/commons.ts";
import { fetchSourceText } from "../lib/fetch-text.ts";

// Fetch a web source's full text and store it in the commons in one move. The
// stored text is the quote-verification corpus for record_claim, so this is
// what lets claims quote from anywhere in a document instead of only the
// ~900-char search snippet. Extraction lives in agent/lib/fetch-text.ts,
// shared with the delegated deep-ingestion pipeline.

// Persisted as the source's text — the ceiling for verifiable quotes.
const STORE_CAP = 60_000;
// Returned to the model to read and quote from. Must be a prefix of the
// stored text so any quote taken from the view passes verification.
const VIEW_CAP = 12_000;

export default defineTool({
  description:
    "Fetch a source URL's full text and store it as a commons source in one step. Returns a source_id plus the text to read — quote record_claim quotes from that text. Prefer this over record_source for anything with a URL: claims can then cite the full document, not just a search snippet. Falls back gracefully; if the page can't be read (paywall, PDF), record the abstract/snippet via record_source instead.",
  inputSchema: z.object({
    url: z.string().min(1).describe("The source URL to fetch."),
    title: z.string().optional(),
    author: z.string().optional(),
    publisher: z.string().optional().describe("Venue / outlet / institution."),
    date: z.string().optional().describe("Publication date if known."),
  }),
  async execute({ url, title, author, publisher, date }, ctx) {
    const fetched = await fetchSourceText(url);
    if (!fetched) {
      return {
        ok: false,
        error:
          "could not extract readable text from this URL (paywall, PDF, or fetch failure) — record the abstract/snippet via record_source instead",
      };
    }
    const stored = fetched.text.slice(0, STORE_CAP);
    const sourceId = await addSource({
      text: stored,
      url,
      title,
      author,
      publisher,
      date,
      retrieval: { operator: "read_source@1", url, via: fetched.via },
      sessionId: ctx?.session?.id,
      turnId: ctx?.session?.turn?.id,
    });
    return {
      ok: true,
      source_id: sourceId,
      chars_stored: stored.length,
      truncated:
        stored.length < fetched.text.length || stored.length > VIEW_CAP,
      text: stored.slice(0, VIEW_CAP),
    };
  },
});
