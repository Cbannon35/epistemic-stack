import { TagIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/app/topics/_components/stat-tile";
import type { ReleaseRecord } from "@/lib/release-types";
import { listAllReleases } from "@/lib/releases";

// The public release gallery. Deliberately NOT the topics grid: a topic slice
// is a living recipe that grows with the commons, so its card sells current
// size (claims/sources/challenges). A release is frozen and versioned, so this
// page sells lineage instead — investigations grouped, versions stacked
// newest-first, each row a citable moment.

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Releases — Epistack",
  description:
    "Frozen, citable checkpoints of knowledge graphs from the epistemic commons. Every release resolves to the same graph forever.",
};

/** Investigations in most-recently-released order, each with its versions
 * newest-first. Grouped by id, not title — titles are snapshots and drift. */
function groupByInvestigation(releases: ReleaseRecord[]): ReleaseRecord[][] {
  const groups = new Map<string, ReleaseRecord[]>();
  for (const release of releases) {
    const existing = groups.get(release.investigationId);
    if (existing) {
      existing.push(release);
    } else {
      groups.set(release.investigationId, [release]);
    }
  }
  return [...groups.values()].map((versions) =>
    [...versions].sort((a, b) => b.version - a.version)
  );
}

function ReleaseRow({ release }: { release: ReleaseRecord }) {
  return (
    <Link
      className="group flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
      href={`/releases/${release.id}`}
    >
      <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[10px] text-muted-foreground tabular-nums">
        v{release.version}
      </span>
      {release.name ? (
        <span className="font-medium text-sm">{release.name}</span>
      ) : null}
      {release.notes ? (
        <span className="line-clamp-1 text-muted-foreground text-xs">
          {release.notes}
        </span>
      ) : null}
      <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">
        cut {formatDate(release.cutoff)} · {release.creatorName}
      </span>
    </Link>
  );
}

function InvestigationGroup({ versions }: { versions: ReleaseRecord[] }) {
  const [latest] = versions;
  return (
    <section className="rounded-xl border border-border/60 bg-background p-4 shadow-[var(--shadow-card)]">
      <h2 className="flex items-center gap-1.5 px-3 font-medium text-sm leading-snug">
        <TagIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {latest.title}
        <span className="font-normal text-[10px] text-muted-foreground">
          {versions.length} {versions.length === 1 ? "release" : "releases"}
        </span>
      </h2>
      <div className="mt-1.5 flex flex-col">
        {versions.map((release) => (
          <ReleaseRow key={release.id} release={release} />
        ))}
      </div>
    </section>
  );
}

export default async function ReleasesPage() {
  const groups = groupByInvestigation(await listAllReleases());
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-widest">
          Epistack
        </p>
        <h1 className="mt-2 font-semibold text-2xl tracking-tight">
          Releases of the epistemic commons
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
          Frozen, citable checkpoints of an investigation's knowledge graph.
          Each release pins a scope to an as-of moment, so its URL resolves to
          exactly the same graph forever — safe to cite in a paper long after
          the room has moved on.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Link
            className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            href="/topics"
          >
            Looking for living slices that keep growing? Topic slices →
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            href="/"
          >
            Open the app →
          </Link>
        </p>
      </header>
      {groups.length === 0 ? (
        <p className="rounded-xl border border-border/60 border-dashed px-6 py-16 text-center text-muted-foreground text-sm">
          No releases cut yet. Inside an investigation, cut a release to freeze
          its graph at a citable moment.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((versions) => (
            <InvestigationGroup
              key={versions[0].investigationId}
              versions={versions}
            />
          ))}
        </div>
      )}
    </main>
  );
}
