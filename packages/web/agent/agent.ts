import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

// Direct provider objects (NOT gateway string ids) — bypasses the Vercel AI
// Gateway and calls the provider directly. Do NOT set AI_GATEWAY_API_KEY /
// VERCEL_OIDC_TOKEN.
//
// NOTE (model choice — flag for review): dev default is a cheap model so the
// tool loop runs inexpensively. Bump to a stronger model (e.g. a Sonnet/Opus
// tier) for real research runs where extraction/dedup quality matters.
export default defineAgent({
  model: selectModel(),

  // Self-hosted durability: session state, queues, streams live in the Postgres
  // Workflow world (not Vercel Workflow). Credentials come from env
  // (WORKFLOW_POSTGRES_URL). eve calls this package's createWorld().start() on
  // host init.
  experimental: {
    workflow: {
      world: "@workflow/world-postgres",
    },
  },

  // Keep native/heavy deps external so their runtimes are traced into the host
  // bundle rather than inlined: @workflow/world-postgres (graphile-worker, pg),
  // and the research tools' deps — @huggingface/transformers ships native
  // onnxruntime-node .node binaries a bundler can't inline.
  build: {
    externalDependencies: [
      "@workflow/world-postgres",
      "@huggingface/transformers",
      "onnxruntime-node",
      "postgres",
    ],
  },
});

// Prefer Anthropic (Claude) when ANTHROPIC_API_KEY is set; fall back to OpenAI.
function selectModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic("claude-haiku-4-5");
  }
  return openai("gpt-5-mini");
}
