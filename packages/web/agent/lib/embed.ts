import {
  type FeatureExtractionPipeline,
  pipeline,
} from "@huggingface/transformers";

// Local sentence embeddings via gte-small (384d, ONNX). No API key. The model
// (~30MB) downloads to the HF cache on first use, then runs offline. Used to
// decide claim identity: two claims are "the same" when their cosine similarity
// clears a threshold (see agent/lib/commons.ts).
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", "Xenova/gte-small");
  }
  return extractorPromise;
}

export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
