import { createHash } from "node:crypto";

/** The receipt payload hash: sha256, hex, truncated — one commons-wide
 * convention. (agent/lib/commons.ts keeps its own copy deliberately; see
 * CLAUDE.md on agent/web duplication.) */
export const contentHash = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 32);
