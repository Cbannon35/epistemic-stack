import { defineTool } from "eve/tools";
import { z } from "zod";

// General web search via Tavily (needs TAVILY_API_KEY). Complements
// search_sources (scholarly): use this for non-academic material — debates,
// journalism, institutional pages, blogs — e.g. the Rootclaim COVID-origins
// debate, which OpenAlex won't surface.
export default defineTool({
  description:
    "Search the general web (news, blogs, institutional pages, debates) via Tavily. Use for non-academic material that scholarly search misses. Returns title, url, and a content snippet per result — read the snippet, then record_source + record_claim for what you use.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Web search query."),
    max_results: z.number().int().min(1).max(10).default(6),
  }),
  async execute({ query, max_results }) {
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
      return { error: "TAVILY_API_KEY not set", results: [] };
    }
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results,
        search_depth: "basic",
        include_answer: false,
      }),
    });
    if (!res.ok) {
      return { error: `Tavily request failed: ${res.status}`, results: [] };
    }
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
      }>;
    };
    return {
      results: (data.results ?? []).map((r) => ({
        title: r.title ?? null,
        url: r.url ?? null,
        snippet: (r.content ?? "").slice(0, 900),
        score: r.score ?? null,
      })),
    };
  },
});
