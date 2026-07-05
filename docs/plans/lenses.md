# Lenses — late-binding trust

The commons stores everything from everyone; **trust is applied at query time,
not write time**. A lens is a named, ordered list of weighting rules; the same
graph read through two lenses yields two different confidence pictures — and
the diff between them is exactly where two worldviews part.

## Rules model (`lib/lenses/`)

```ts
type LensMatch = {
  kinds?: NodeKind[];                    // limit rule to node kinds
  contributorKind?: "human" | "agent";   // who wrote it (via contribution receipt)
  contributorIds?: string[];             // specific contributors
  maxSources?: number; minSources?: number;  // claim corroboration
  modality?: string[];                   // claim hedging (speculates, suggests…)
  peerReviewed?: boolean;                // source guarantee
  olderThanDays?: number;                // contribution age
  // Extension point: siblings add dimensions here at integration
  // (e.g. contested?: boolean — node has open challenges).
};
type LensRule = { id: string; label: string; match: LensMatch; weight: number };
```

**Evaluator semantics** (pure, deterministic): score starts at 1.0; each rule
whose match fields ALL apply multiplies the score by `weight`; final clamp to
[0, 1]. Fields a node can't satisfy (e.g. `modality` on a source) simply don't
match. Provenance fields resolve through a `provenance` map shipped with the
graph payload. Evaluation is client-side over already-fetched data.

## Persistence

- Reuse the existing `lenses` table; rules live in `config.rules` (jsonb).
- Additive columns: `owner_id` (uuid → contributors, nullable) and
  `created_at` (defaultNow) — migration generated at integration.
- Saving a lens writes a **contribution receipt** first (method
  `lens-editor@1`, payloadHash = sha256 of the rules JSON): even perspectives
  have receipts.
- Built-ins (Raw / Skeptic / Primary sources / Humans only) live in code.

## Graph payload provenance (additive)

`buildGraphData` already selects contributions; extend the select with
`contributorId`, `method`, `createdAt`, join contributor names/kinds, and emit
`provenance: Record<nodeId, {contributorId, contributorName, contributorKind,
method, createdAt}>` alongside nodes/edges.

## UI (`app/_components/lenses/`)

- **LensControl** — toolbar pill + popover: pick the active lens (built-ins +
  everyone's custom lenses, labeled by owner), open the rule-builder editor,
  toggle compare mode. Active lens id persists in localStorage.
- **LensEditor** — form-based rule builder: preset dropdown per rule (agent-
  written, single-sourced, speculative, not peer-reviewed, specific
  contributor, older than N days…), weight slider, name/description, save.
- **Rendering** — node opacity = 0.25 + 0.75·score (selected node stays full);
  edge opacity = min of its endpoints; score chip in the Inspector.
- **Diff mode** — pick lens A vs B: nodes outlined toward A-color or B-color by
  signed divergence; ranked "where you part ways" panel, click → focus node.

## Out of scope (noted for later)

- Lens name in presence meta / adopt-a-teammate's-lens (stretch).
- Lens summary in /api/tour context (stretch).
- Deleting lenses (commons is append-only; needs an archival story).
