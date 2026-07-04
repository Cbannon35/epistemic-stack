import { NextResponse } from "next/server";
import { buildGraphData } from "@/lib/graph-data";

// Thin wrapper — the graph read model lives in lib/graph-data.ts, shared with
// the tour generator.
export async function GET(request: Request) {
  const investigation = new URL(request.url).searchParams.get("investigation");
  return NextResponse.json(await buildGraphData(investigation));
}
