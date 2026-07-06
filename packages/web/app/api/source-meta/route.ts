import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Open-graph metadata for source cards (rich previews in the source rail).
// Plain server-side fetch of the source page — the same pages eve already
// reads — with a small in-memory cache. Best-effort: failures return nulls.

type SourceMeta = {
  image: string | null;
  description: string | null;
  site: string | null;
};

const EMPTY: SourceMeta = { image: null, description: null, site: null };
const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 4000;
const CACHE_CAP = 500;

const cache = new Map<string, SourceMeta>();

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`,
      "i"
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

async function scrape(url: string): Promise<SourceMeta> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; epistack-preview/1.0; +https://github.com/Cbannon35/epistemic-stack)",
      accept: "text/html",
    },
  });
  if (!res.ok) {
    return EMPTY;
  }
  const html = (await res.text()).slice(0, MAX_HTML_BYTES);
  const rawImage =
    metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  let image: string | null = null;
  if (rawImage) {
    try {
      image = new URL(rawImage, url).toString();
    } catch {
      image = null;
    }
  }
  return {
    image,
    description:
      metaContent(html, "og:description") ?? metaContent(html, "description"),
    site: metaContent(html, "og:site_name"),
  };
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(EMPTY, { status: 401 });
  }

  const url = new URL(req.url).searchParams.get("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(EMPTY);
  }

  const hit = cache.get(url);
  if (hit) {
    return NextResponse.json(hit);
  }

  let meta = EMPTY;
  try {
    meta = await scrape(url);
  } catch {
    meta = EMPTY;
  }
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.delete(oldest);
    }
  }
  cache.set(url, meta);
  return NextResponse.json(meta);
}
