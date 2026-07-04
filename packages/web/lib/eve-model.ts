import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

// The model behind eve's lightweight, non-agent surfaces (graph tours,
// comment-thread replies). Prefer Anthropic when the key is present — the
// same policy as the eve agent itself (agent/agent.ts).
export function selectEveModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic("claude-haiku-4-5");
  }
  return openai("gpt-5-mini");
}
