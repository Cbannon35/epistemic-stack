// Built-in lenses — the perspectives everyone starts with. Saved lenses come
// from the `lenses` table; these live in code so they're always available and
// versioned with the app.

import type { LensDefinition } from "./types";

export const RAW_LENS_ID = "builtin:raw";

export const BUILTIN_LENSES: LensDefinition[] = [
  {
    id: RAW_LENS_ID,
    name: "Raw",
    description: "Everything at full weight — the commons as written.",
    rules: [],
    builtin: true,
  },
  {
    id: "builtin:skeptic",
    name: "Skeptic",
    description:
      "Discounts agent-written entries, single-sourced claims, and hedged language.",
    rules: [
      {
        id: "agent-written",
        label: "agent-written",
        match: { contributorKind: "agent" },
        weight: 0.5,
      },
      {
        id: "thin-corroboration",
        label: "≤1 corroborating source",
        match: { maxSources: 1 },
        weight: 0.6,
      },
      {
        id: "hedged",
        label: "speculative or suggestive",
        match: { modality: ["speculates", "suggests"] },
        weight: 0.6,
      },
    ],
    builtin: true,
  },
  {
    id: "builtin:primary-sources",
    name: "Primary sources",
    description: "Leans on peer-reviewed material; uncorroborated claims fade.",
    rules: [
      {
        id: "not-peer-reviewed",
        label: "not peer-reviewed",
        match: { peerReviewed: false },
        weight: 0.45,
      },
      {
        id: "unsourced",
        label: "no corroborating source",
        match: { maxSources: 0 },
        weight: 0.4,
      },
    ],
    builtin: true,
  },
  {
    id: "builtin:humans-only",
    name: "Humans only",
    description: "Near-mutes anything an agent wrote into the record.",
    rules: [
      {
        id: "agent-written",
        label: "agent-written",
        match: { contributorKind: "agent" },
        weight: 0.15,
      },
    ],
    builtin: true,
  },
];

export function isBuiltinLensId(id: string): boolean {
  return id.startsWith("builtin:");
}
