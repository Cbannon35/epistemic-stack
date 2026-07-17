import { NextResponse } from "next/server";
import { listReleases } from "@/lib/releases";
import { createClient } from "@/lib/supabase/server";

// Version list for one investigation — feeds the release dialog.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const investigation = new URL(request.url).searchParams.get("investigation");
  if (!investigation) {
    return NextResponse.json(
      { error: "investigation required" },
      { status: 400 }
    );
  }
  return NextResponse.json({ releases: await listReleases(investigation) });
}
