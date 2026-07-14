import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { GraphEdge, GraphNode } from "@/app/_components/graph/types";
import { getTopic, resolveTopicSlice } from "@/lib/topics";
import { ConnectCard } from "../_components/connect-card";
import { TopicGraphPreview } from "../_components/topic-graph-preview";

// Public page for one topic slice: the graph itself, its numbers, and the
// two takeaway actions — connect an assistant over MCP, or download the JSON.

export const revalidate = 60;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const topic = await getTopic(slug);
  if (!topic) {
    return { title: "Unknown topic — Epistack" };
  }
  return {
    title: `${topic.name} — Epistack topic slice`,
    description:
      topic.description ??
      `A living knowledge graph about "${topic.name}" from the epistemic commons.`,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
      <p className="font-semibold text-xl tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function TopicPage({ params }: Params) {
  const { slug } = await params;
  const resolved = await resolveTopicSlice(slug);
  if (!resolved) {
    notFound();
  }
  const { topic, graph } = resolved;
  const contributorCount = new Set(
    Object.values(graph.provenance).map((p) => p.contributorId)
  ).size;
  const hypotheses = graph.assessment.hypotheses;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="mb-8">
        <Link
          className="text-muted-foreground text-xs underline-offset-4 transition-colors hover:text-foreground hover:underline"
          href="/topics"
        >
          ← All topics
        </Link>
        <h1 className="mt-3 font-semibold text-2xl tracking-tight">
          {topic.name}
        </h1>
        {topic.description ? (
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            {topic.description}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">
          A living slice of the epistemic commons — it grows as the commons
          grows. Published by {topic.creatorName} ·{" "}
          {formatDate(topic.createdAt)}
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
          <h2 className="mb-2 font-medium text-sm">Hypotheses in this slice</h2>
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
        <ConnectCard slug={topic.slug} />
        <a
          className="flex h-fit items-center gap-2 rounded-xl border border-border/60 bg-background px-4 py-3 text-sm shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-[var(--shadow-float)]"
          download
          href={`/api/topics/${topic.slug}/export`}
        >
          <DownloadIcon className="size-4 text-muted-foreground" />
          Download JSON
        </a>
      </div>
    </main>
  );
}
