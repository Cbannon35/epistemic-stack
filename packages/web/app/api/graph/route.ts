import { NextResponse } from "next/server";
import { buildGraphData } from "@/lib/graph-data";
import { getMergeRequest, previewHops } from "@/lib/merge";

// Thin wrapper — the graph read model lives in lib/graph-data.ts, shared with
// the tour generator. `mergePreview=<mrId>` widens the scope by the source's
// live hops so a reviewer can see the target graph as it WOULD look.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const investigation = params.get("investigation");
  const mergePreview = params.get("mergePreview");
  if (investigation && mergePreview) {
    const mr = await getMergeRequest(mergePreview);
    if (mr && mr.targetId === investigation && mr.status === "open") {
      const extraHops = await previewHops(mr.sourceId, mr.targetId);
      return NextResponse.json(
        await buildGraphData(investigation, { extraHops })
      );
    }
  }
  return NextResponse.json(await buildGraphData(investigation));
}
