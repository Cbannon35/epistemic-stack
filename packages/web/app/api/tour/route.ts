import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildGraphData, type GraphNodeData } from "@/lib/graph-data";
import { createClient } from "@/lib/supabase/server";

// "@eve <question>": one model call that first DECIDES what the question
// warrants — a quick answer (eve replies in a bubble at your cursor) or a
// guided tour (the eve cursor walks the room through the graph). Callers pass
// recent conversation context so eve isn't stateless across chats and tours.

const MAX_CATALOG_NODES = 120;
const LABEL_CLIP = 160;
const MAX_CONTEXT_CHARS = 4000;

const eveSchema = z.object({
  mode: z
    .enum(["answer", "tour"])
    .describe(
      "answer: the question wants a direct reply (a fact, a count, an opinion, a follow-up to the conversation). tour: the question is best served by walking through several graph nodes in sequence."
    ),
  answer: z
    .string()
    .describe(
      "mode=answer: the reply, 1-3 plain sentences. mode=tour: empty string."
    ),
  intro: z
    .string()
    .describe(
      "mode=tour: 1-2 sentences framing the walk. mode=answer: empty string."
    ),
  steps: z
    .array(
      z.object({
        nodeId: z.string().describe("EXACT id copied from the catalog"),
        narration: z
          .string()
          .describe("1-2 sentences on this node's role in the answer"),
      })
    )
    .max(8)
    .describe("mode=tour: 2-8 stops. mode=answer: empty array."),
  conclusion: z
    .string()
    .describe(
      "mode=tour: 1-2 sentences wrapping up. mode=answer: empty string."
    ),
});

// Prefer Anthropic when the key is present — same policy as the eve agent.
function selectModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic("claude-haiku-4-5");
  }
  return openai("gpt-5-mini");
}

// Sources get trimmed first when the graph is large: tours are about the
// argument structure (hypotheses, claims, cruxes), not the bibliography.
function catalogNodes(nodes: GraphNodeData[]): GraphNodeData[] {
  if (nodes.length <= MAX_CATALOG_NODES) {
    return nodes;
  }
  const priority: Record<GraphNodeData["kind"], number> = {
    hypothesis: 0,
    crux: 1,
    claim: 2,
    source: 3,
  };
  return [...nodes]
    .sort((a, b) => priority[a.kind] - priority[b.kind])
    .slice(0, MAX_CATALOG_NODES);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    question?: string;
    investigation?: string | null;
    context?: string;
  } | null;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  const context = body?.context?.slice(0, MAX_CONTEXT_CHARS);

  const graph = await buildGraphData(body?.investigation ?? null);
  const catalog = catalogNodes(graph.nodes);
  const catalogIds = new Set(catalog.map((n) => n.id));
  const catalogLines = catalog
    .map((n) => `${n.id} | ${n.kind} | ${n.label.slice(0, LABEL_CLIP)}`)
    .join("\n");
  const adjacency = graph.edges
    .filter((e) => catalogIds.has(e.source) && catalogIds.has(e.target))
    .map((e) => `${e.source} -${e.kind}-> ${e.target}`)
    .join("\n");

  const { object } = await generateObject({
    model: selectModel(),
    schema: eveSchema,
    prompt: [
      "You are eve, a research guide embedded in a live argument map (an epistemic claim graph) that a team is exploring together.",
      `A member asked: "${question}"`,
      "First decide the MODE. Prefer a direct answer for lookups, counts, judgment calls, or follow-ups to the conversation; reserve a tour for questions where physically walking node-to-node through the evidence genuinely helps (e.g. 'walk me through the case for X', 'what supports/contradicts Y'). A tour needs at least 2 meaningful stops using EXACT node ids from the catalog.",
      context ? `\nCONVERSATION SO FAR:\n${context}` : "",
      "",
      "NODE CATALOG (id | kind | label):",
      catalogLines || "(the graph is empty so far)",
      "",
      "EDGES:",
      adjacency,
    ].join("\n"),
  });

  const tourId = crypto.randomUUID();

  // Hallucination guard: drop steps whose node id isn't actually in the graph;
  // a "tour" with no surviving stops degrades gracefully to an answer.
  const validSteps = object.steps.filter((s) => catalogIds.has(s.nodeId));
  if (object.mode === "tour" && validSteps.length > 0) {
    return NextResponse.json({
      mode: "tour",
      tourId,
      intro: object.intro,
      steps: validSteps,
      conclusion: object.conclusion,
    });
  }
  const answer =
    object.answer || object.intro || "I don't have a good answer for that yet.";
  return NextResponse.json({ mode: "answer", tourId, answer });
}
