import "server-only";

// Web search for delegated investigations — same Tavily surface as the eve
// agent's search_web tool (agent/tools/search_web.ts), reimplemented here so a
// route handler doesn't import eve's tool wrapper. Degrades to an empty result
// set when TAVILY_API_KEY is missing: the run then only adds STRUCTURE
// (relations, cruxes, hypotheses) over existing evidence — no source, no claim.

export type WebFinding = {
  title: string | null;
  url: string | null;
  snippet: string;
  query: string;
};

const MAX_RESULTS_PER_QUERY = 5;
const SNIPPET_CLIP = 900;

export function webSearchAvailable(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function searchWeb(query: string): Promise<WebFinding[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    return [];
  }
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: MAX_RESULTS_PER_QUERY,
      search_depth: "basic",
      include_answer: false,
    }),
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? null,
    url: r.url ?? null,
    snippet: (r.content ?? "").slice(0, SNIPPET_CLIP),
    query,
  }));
}
