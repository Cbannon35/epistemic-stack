import { generateText } from "ai";
import { NextResponse } from "next/server";
import {
  EVE_CONTRIBUTOR_ID,
  ensureEveContributor,
  getComment,
  insertComment,
  listComments,
} from "@/lib/comments";
import { selectEveModel } from "@/lib/eve-model";
import { createClient } from "@/lib/supabase/server";

const MAX_CONTEXT_CHARS = 3000;

// "@eve" inside a comment thread: eve replies in-thread — one stateless model
// call over the quoted passage, the thread so far, and optional transcript
// context the client sends along. The reply inherits the thread's visibility
// (a private note's eve reply stays private).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    commentId?: string;
    question?: string;
    context?: string;
  } | null;
  const commentId = body?.commentId;
  const question = body?.question?.trim();
  if (!(commentId && question)) {
    return NextResponse.json(
      { error: "commentId and question required" },
      { status: 400 }
    );
  }

  const root = await getComment(commentId);
  if (!root || root.parentId !== null) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }
  if (root.visibility === "private" && root.authorId !== user.id) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  const all = await listComments(root.sessionId, user.id);
  const thread = all.filter((c) => c.id === root.id || c.parentId === root.id);

  const { text } = await generateText({
    model: selectEveModel(),
    prompt: [
      "You are eve, a research colleague replying inline in a comment thread on a shared investigation transcript. Reply in 1-3 plain, specific sentences. No preamble.",
      root.quote
        ? `The thread is anchored to this passage: "${root.quote}"`
        : "",
      "Thread so far:",
      ...thread.map((c) => `- ${c.authorName}: ${c.body}`),
      `- ${thread.at(-1)?.authorName ?? "someone"} asks you: ${question}`,
      body?.context
        ? `\nConversation context:\n${body.context.slice(0, MAX_CONTEXT_CHARS)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  await ensureEveContributor();
  const replyId = await insertComment({
    sessionId: root.sessionId,
    authorId: EVE_CONTRIBUTOR_ID,
    body: text.slice(0, 2000),
    visibility: root.visibility as "public" | "private",
    parentId: root.id,
  });

  return NextResponse.json({ id: replyId, body: text });
}
