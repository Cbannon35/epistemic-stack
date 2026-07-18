import { DownloadIcon, TagIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { GraphEdge, GraphNode } from "@/app/_components/graph/types";
import { formatDate, StatTile } from "@/app/topics/_components/stat-tile";
import { TopicGraphPreview } from "@/app/topics/_components/topic-graph-preview";
import { getRelease, releaseGraph } from "@/lib/releases";
import { CitationCard } from "./citation-card";

// Public, citable page for one release: the graph exactly as it stood at the
// cut moment, forever. Unauthenticated like /topics — releases exist to be
// pointed at from outside.

export const revalidate = 300;

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const release = await getRelease(id);
  if (!release) {
    return { title: "Unknown release — Epistack" };
  }
  return {
    title: `${release.title} (v${release.version}) — Epistack release`,
    description: `Citable snapshot of the "${release.title}" knowledge graph, cut ${release.cutoff.slice(0, 10)}.`,
  };
}

export default async function ReleasePage({ params }: Params) {
  const { id } = await params;
  const release = await getRelease(id);
  if (!release) {
    notFound();
  }
  const { hops: _hops, ...record } = release;
  const graph = await releaseGraph(release);
  const contributorCount = new Set(
    Object.values(graph.provenance).map((p) => p.contributorId)
  ).size;
  const hypotheses = graph.assessment.hypotheses;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="mb-8">
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <TagIcon className="size-3.5" />
          Release v{release.version}
          {release.name ? ` — ${release.name}` : ""}
        </p>
        <h1 className="mt-3 font-semibold text-2xl tracking-tight">
          {release.title}
        </h1>
        {release.notes ? (
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            {release.notes}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">
          A frozen, citable checkpoint of this investigation's knowledge graph —
          exactly as it stood on {formatDate(release.cutoff)}. Cut by{" "}
          {release.creatorName}.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="claims" value={graph.counts.claims} />
        <StatTile label="sources" value={graph.counts.sources} />
        <StatTile label="challenges" value={graph.counts.challenges} />
        <StatTile label="contributors" value={contributorCount} />
      </div>

      <TopicGraphPreview
        edges={graph.edges as GraphEdge[]}
        nodes={graph.nodes as GraphNode[]}
      />

      {hypotheses.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 font-medium text-sm">
            Hypotheses at the cut moment
          </h2>
          <ul className="space-y-2">
            {hypotheses.map((h) => (
              <li
                className="rounded-xl border border-border/60 bg-background px-4 py-3"
                key={h.id}
              >
                <p className="text-sm leading-snug">{h.statement}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {h.claimCount} linked{" "}
                  {h.claimCount === 1 ? "claim" : "claims"} · support{" "}
                  {h.support.toFixed(1)} · undermine {h.undermine.toFixed(1)}
                  {typeof h.credence === "number"
                    ? ` · community credence ${Math.round(h.credence * 100)}% (${h.credenceCount})`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
        <CitationCard release={record} />
        <a
          className="flex h-fit items-center gap-2 rounded-xl border border-border/60 bg-background px-4 py-3 text-sm shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-[var(--shadow-float)]"
          download
          href={`/api/releases/${id}/export`}
        >
          <DownloadIcon className="size-4 text-muted-foreground" />
          Download JSON
        </a>
      </div>
    </main>
  );
}
