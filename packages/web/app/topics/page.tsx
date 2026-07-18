import type { Metadata } from "next";
import Link from "next/link";
import { listTopics, type TopicListItem } from "@/lib/topics";
import { formatDate } from "./_components/stat-tile";

// The public gallery: every published topic slice of the commons, browsable
// without an account. Cards echo the graph's pill vocabulary so the gallery
// reads as "knowledge graphs", not generic content cards.

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Topic slices — Epistack",
  description:
    "Living knowledge graphs exported from the epistemic commons. Browse a topic, download its claim graph, or connect it to your AI assistant over MCP.",
};

// Chips borrow the graph's node palette: claims wear the claim-pill blue,
// challenges the crux red, sources the dashed evidence-ghost ring.
function StatChips({ stats }: { stats: TopicListItem["stats"] }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[10px]">
      <span className="rounded-full bg-[#d8e5ff] px-2 py-0.5 font-medium text-[#3c66c4] dark:bg-[#3c66c4]/25 dark:text-[#a8c2f5]">
        {stats.claims} claims
      </span>
      <span className="rounded-full border border-muted-foreground/40 border-dashed px-2 py-0.5 text-muted-foreground">
        {stats.sources} sources
      </span>
      {stats.challenges > 0 ? (
        <span className="rounded-full bg-[#fad3d0] px-2 py-0.5 font-medium text-[#c04440] dark:bg-[#c04440]/25 dark:text-[#f0a8a3]">
          {stats.challenges} challenges
        </span>
      ) : null}
      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
        {stats.contributors}{" "}
        {stats.contributors === 1 ? "contributor" : "contributors"}
      </span>
    </p>
  );
}

function TopicCard({ topic }: { topic: TopicListItem }) {
  return (
    <Link
      className="group flex flex-col gap-2.5 rounded-xl border border-border/60 bg-background p-4 shadow-[var(--shadow-card)] transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-border hover:shadow-[var(--shadow-float)]"
      href={`/topics/${topic.slug}`}
    >
      <h2 className="font-medium text-sm leading-snug">{topic.name}</h2>
      {topic.description ? (
        <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
          {topic.description}
        </p>
      ) : null}
      <StatChips stats={topic.stats} />
      <p className="mt-auto pt-1 text-[10px] text-muted-foreground">
        published by {topic.creatorName} · {formatDate(topic.createdAt)}
      </p>
    </Link>
  );
}

export default async function TopicsPage() {
  const topics = await listTopics();
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="mb-10">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-widest">
          Epistack
        </p>
        <h1 className="mt-2 font-semibold text-2xl tracking-tight">
          Topic slices of the epistemic commons
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
          Living knowledge graphs — claims with verbatim quotes, sources,
          challenges, and receipts — published from shared investigations. Each
          slice grows as the commons grows. Browse one, download it, or connect
          it straight to your AI assistant.
        </p>
        <Link
          className="mt-3 inline-block text-muted-foreground text-xs underline-offset-4 transition-colors hover:text-foreground hover:underline"
          href="/"
        >
          Open the app →
        </Link>
      </header>
      {topics.length === 0 ? (
        <p className="rounded-xl border border-border/60 border-dashed px-6 py-16 text-center text-muted-foreground text-sm">
          No topics published yet. Inside the app, search the commons and
          publish your first slice.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((topic) => (
            <TopicCard key={topic.id} topic={topic} />
          ))}
        </div>
      )}
    </main>
  );
}
