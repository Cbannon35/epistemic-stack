import { defineTool } from "eve/tools";
import { z } from "zod";

// Free, no-key scholarly search via OpenAlex. Returns candidate sources (title,
// abstract, authors, venue, year, doi/url) for the agent to read and extract
// claims from. Web search (news/blogs) can be added later behind a key.

function abstractFromInverted(
  inv: Record<string, number[]> | null | undefined
): string | null {
  if (!inv) {
    return null;
  }
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) {
      words[p] = word;
    }
  }
  return words.join(" ").trim() || null;
}

export default defineTool({
  description:
    "Search scholarly literature (OpenAlex) for sources relevant to a query. Returns candidate works with title, abstract, authors, venue, year, and a URL/DOI. Use this to find evidence, then read the abstract and record_source + record_claim for what you use.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("Search query — a topic, claim, or subtopic."),
    limit: z.number().int().min(1).max(25).default(6).describe("Max results."),
  }),
  async execute({ query, limit }) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(
      query
    )}&per_page=${limit}&mailto=epistemic-stack@example.com`;
    const res = await fetch(url);
    if (!res.ok) {
      return { error: `OpenAlex request failed: ${res.status}`, results: [] };
    }
    const data = (await res.json()) as { results?: unknown[] };
    const results = (data.results ?? []).map((raw) => {
      const w = raw as Record<string, any>;
      return {
        title: w.title as string | null,
        doi: w.doi as string | null,
        year: w.publication_year as number | null,
        authors: ((w.authorships ?? []) as any[])
          .map((a) => a.author?.display_name)
          .filter(Boolean)
          .slice(0, 5),
        venue: w.primary_location?.source?.display_name ?? null,
        url: w.primary_location?.landing_page_url ?? w.doi ?? null,
        peer_reviewed: w.primary_location?.source?.type === "journal",
        abstract: abstractFromInverted(w.abstract_inverted_index),
      };
    });
    return { results };
  },
});
