import { NextResponse } from "next/server";
import { resolveTopicSlice } from "@/lib/topics";

// Public download of a topic slice — the whole point is that outsiders can
// take the graph with them, so (like /api/graph) there is no auth gate. The
// payload carries per-node provenance receipts; trust stays a read-time call
// for whoever consumes it.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const resolved = await resolveTopicSlice(slug);
  if (!resolved) {
    return NextResponse.json({ error: "unknown topic" }, { status: 404 });
  }
  const { topic, graph } = resolved;
  return NextResponse.json(
    {
      topic: {
        slug: topic.slug,
        name: topic.name,
        description: topic.description,
        seedQuery: topic.seedQuery,
        creator: topic.creatorName,
        createdAt: topic.createdAt,
      },
      generatedAt: new Date().toISOString(),
      graph,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="${topic.slug}-commons-slice.json"`,
      },
    }
  );
}
