import { NextResponse } from "next/server";
import { citationFor } from "@/lib/release-types";
import { getRelease, releaseGraph } from "@/lib/releases";

// Public download of a release — a frozen, citable graph with provenance
// receipts. No auth gate, same rationale as the topic export: the whole
// point is that outsiders can take (and cite) the graph.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const release = await getRelease(id);
  if (!release) {
    return NextResponse.json({ error: "unknown release" }, { status: 404 });
  }
  const origin = new URL(request.url).origin;
  const graph = await releaseGraph(release);
  return NextResponse.json(
    {
      release: {
        id: release.id,
        title: release.title,
        version: release.version,
        name: release.name,
        notes: release.notes,
        cutoff: release.cutoff,
        creator: release.creatorName,
        citation: citationFor(release, origin),
      },
      generatedAt: new Date().toISOString(),
      graph,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="release-v${release.version}-${release.id.slice(0, 8)}.json"`,
      },
    }
  );
}
