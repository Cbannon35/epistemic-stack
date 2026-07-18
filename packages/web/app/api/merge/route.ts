import { NextResponse } from "next/server";
import { listMergeRequests } from "@/lib/merge";
import { getAuthUser } from "@/lib/supabase/server";

// Merge requests involving one investigation (as source or target) — room
// boot + refetch-on-`merge:changed`. Route handler, not a server action:
// panels fetch it during render.
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const investigation = new URL(request.url).searchParams.get("investigation");
  if (!investigation) {
    return NextResponse.json(
      { error: "investigation required" },
      {
        status: 400,
      }
    );
  }
  return NextResponse.json({
    mergeRequests: await listMergeRequests(investigation),
  });
}
