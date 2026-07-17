// Shared release types + the citation formatter (client + server) — the
// lib/challenge-types.ts pattern: lib/releases.ts ("server-only") implements
// against these; the release dialog and public page import them freely.

export type ReleaseRecord = {
  id: string;
  investigationId: string;
  /** Investigation title at cut time — citations must not drift with renames. */
  title: string;
  version: number;
  name: string | null;
  notes: string | null;
  /** ISO timestamp — the graph is rendered as of this moment, forever. */
  cutoff: string;
  createdBy: string;
  creatorName: string;
  createdAt: string;
};

export type Citation = { plain: string; bibtex: string };

export function citationFor(release: ReleaseRecord, origin: string): Citation {
  const url = `${origin}/releases/${release.id}`;
  const date = release.cutoff.slice(0, 10);
  const year = date.slice(0, 4);
  const label = release.name ? ` — ${release.name}` : "";
  const plain = `${release.creatorName}. “${release.title}” (v${release.version}${label}). Epistemic commons release, ${date}. ${url}`;
  const bibtex = [
    `@misc{epistack_${release.id.slice(0, 8)}_v${release.version},`,
    `  author = {${release.creatorName}},`,
    `  title = {${release.title} (v${release.version}${label})},`,
    "  howpublished = {Epistemic commons release},",
    `  year = {${year}},`,
    `  note = {Graph as of ${release.cutoff}},`,
    `  url = {${url}}`,
    "}",
  ].join("\n");
  return { plain, bibtex };
}
