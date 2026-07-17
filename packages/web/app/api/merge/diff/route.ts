import { NextResponse } from "next/server";
import { computeMergeDiff, getMergeRequest } from "@/lib/merge";
import { createClient } from "@/lib/supabase/server";

// What a merge would adopt: `?mr=<id>` diffs an existing request's pair;
// `?source=&target=` previews before one exists (the propose dialog).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  let source = params.get("source");
  let target = params.get("target");
  const mrId = params.get("mr");
  if (mrId) {
    const mr = await getMergeRequest(mrId);
    if (!mr) {
      return NextResponse.json(
        { error: "unknown merge request" },
        {
          status: 404,
        }
      );
    }
    source = mr.sourceId;
    target = mr.targetId;
  }
  if (!(source && target)) {
    return NextResponse.json(
      { error: "mr or source+target required" },
      { status: 400 }
    );
  }
  return NextResponse.json(await computeMergeDiff(source, target));
}
