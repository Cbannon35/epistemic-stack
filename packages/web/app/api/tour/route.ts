import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildGraphData, type GraphNodeData } from "@/lib/graph-data";
import { createClient } from "@/lib/supabase/server";

// "@eve, walk me through it": one LLM call turns the current claim graph into
// a guided tour — an ordered walk over real node ids with narration. The
// client animates the eve cursor through the steps and broadcasts them to the
// room. No eve session involved; this is a direct, stateless model call.

const MAX_CATALOG_NODES = 120;
const LABEL_CLIP = 160;

const tourSchema = z.object({
  intro: z
    .string()
    .describe("1-2 sentences framing how the graph answers the question"),
  steps: z
    .array(
      z.object({
        nodeId: z.string().describe("EXACT id copied from the catalog"),
        narration: z
          .string()
          .describe("1-2 sentences on this node's role in the answer"),
      })
    )
    .min(2)
    .max(8),
  conclusion: z.string().describe("1-2 sentences wrapping up the walk"),
});

export type TourPlan = z.infer<typeof tourSchema> & { tourId: string };

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
  } | null;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const graph = await buildGraphData(body?.investigation ?? null);
  if (graph.nodes.length < 2) {
    return NextResponse.json(
      { error: "not enough of a graph to tour yet" },
      { status: 422 }
    );
  }

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
    schema: tourSchema,
    prompt: [
      "You are eve, a research guide walking collaborators through a live argument map (an epistemic claim graph).",
      `A member asked: "${question}"`,
      "Pick 2-8 nodes that best answer the question, ordered as a walkthrough (e.g. hypothesis -> key supporting claim -> contradicting claim -> open crux). Use EXACT node ids from the catalog. Narrate each stop in 1-2 plain, specific sentences.",
      "",
      "NODE CATALOG (id | kind | label):",
      catalogLines,
      "",
      "EDGES:",
      adjacency,
    ].join("\n"),
  });

  // Hallucination guard: drop steps whose node id isn't actually in the graph.
  const validSteps = object.steps.filter((s) => catalogIds.has(s.nodeId));
  if (validSteps.length === 0) {
    return NextResponse.json(
      { error: "the guide lost the map — try again" },
      { status: 422 }
    );
  }

  return NextResponse.json({
    tourId: crypto.randomUUID(),
    intro: object.intro,
    steps: validSteps,
    conclusion: object.conclusion,
  });
}
