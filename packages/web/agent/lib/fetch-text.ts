// Full-text retrieval for web sources — shared by the eve chat tool
// (agent/tools/read_source.ts) and the delegated deep-ingestion pipeline
// (lib/delegate/run.ts). Uses Tavily's extract endpoint when a key is set
// (readability-quality extraction); falls back to a raw fetch + HTML strip.

export type FetchedText = {
  text: string;
  /** How the text was obtained — recorded in the source's retrieval receipt. */
  via: "tavily-extract" | "http";
};

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtml(html: string): string {
  return collapse(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
  );
}

async function extractViaTavily(
  url: string,
  key: string
): Promise<string | null> {
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, urls: [url] }),
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as {
    results?: Array<{ raw_content?: string }>;
  };
  const raw = data.results?.[0]?.raw_content;
  return raw ? collapse(raw) || null : null;
}

async function extractViaFetch(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "user-agent": "epistemic-stack/0.1 (research agent)" },
    redirect: "follow",
  });
  if (!res.ok) {
    return null;
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) {
    return null;
  }
  const body = await res.text();
  const text = type.includes("html") ? stripHtml(body) : collapse(body);
  return text || null;
}

/** Fetch a URL's readable full text, or null (paywall, PDF, fetch failure). */
export async function fetchSourceText(
  url: string
): Promise<FetchedText | null> {
  const key = process.env.TAVILY_API_KEY;
  if (key) {
    try {
      const text = await extractViaTavily(url, key);
      if (text) {
        return { text, via: "tavily-extract" };
      }
    } catch {
      // Fall through to the raw fetch.
    }
  }
  try {
    const text = await extractViaFetch(url);
    return text ? { text, via: "http" } : null;
  } catch {
    return null;
  }
}
