# Commons seeds

Portable exports of a single investigation's **commons subgraph** — the claim
graph with full provenance — so anyone can load a worked example into a fresh
database instead of re-running the investigation from scratch. This is the
"compounding" idea made concrete: don't rebuild, build on.

## Available seeds

| File | Investigation | Contents |
| --- | --- | --- |
| `covid-lab-leak.json` | *Did COVID originate from a lab leak?* | 38 claims · 18 full-text sources · 69 mentions · 4 hypotheses · 61 claim↔hypothesis links |

## Load one

From the repo root, pointed at any Postgres that already has the schema applied
(`bun run db:migrate` first):

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres \
  bun packages/db/scripts/load-seed.ts data/seeds/covid-lab-leak.json
```

Loading is **idempotent** and additive — every insert is `onConflictDoNothing`,
so re-running is a no-op, and loading into a commons that already has data just
merges (content-addressed claims/sources dedupe by id — the "many sources, one
claim" invariant holds across seeds too). Open the app and the graph renders
immediately, with receipts intact.

## What's in a seed (and what isn't)

Each seed carries the **commons tables** for the investigation, scoped by the
contribution receipt spine: contributors, contributions, sources (with stored
full text), claims (**with 384-d embeddings**, so dedup and semantic search work
the moment it's loaded), mentions, relations, cruxes, hypotheses, hypothesis
links, assessments, and the investigation row.

It does **not** carry the durable eve chat session (that lives in a separate
workflow store), so the graph loads but the original chat transcript does not
replay. The value is the argument graph, not the conversation.

## Export another

```sh
DATABASE_URL=... bun packages/db/scripts/export-investigation.ts <sessionId> [outFile]
```

Scopes to that session's contributions and everything FK'd to them.
