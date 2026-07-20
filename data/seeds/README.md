# Seeds

Portable exports of an investigation so anyone can load a worked example into a
fresh install instead of re-running it. An investigation has **two** halves,
stored separately, with a file + script for each:

Each investigation ships three files:

| Half | File pattern | What it is |
| --- | --- | --- |
| **Commons graph** | `<name>.json` | The claim graph with full provenance — claims (with embeddings), sources, hypotheses, links, receipts. Lives in the commons tables. |
| **Chat session** | `<name>.session.json` | eve's durable session — the replayable transcript (your question + everything eve said + her tool calls). Lives in eve's `workflow` store. |
| _(readable)_ | `<name>-transcript.json` | A plain, decoded transcript (question + eve's messages) for reading outside the app. Not needed to load. |

Available seeds:

| Name | Investigation | Graph |
| --- | --- | --- |
| `covid-lab-leak` | *Did COVID originate from a lab leak?* | 48 claims · 19 sources · 4 hypotheses · 64 links |
| `eggs` | *Are eggs good to eat?* | 22 claims · 22 sources · 3 hypotheses · 85 links |

## Load it (both halves)

From the repo root, against a database with the schema applied (`bun run
db:migrate`) — ideally a **fresh** install:

```sh
# 1. the claim graph
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres \
  bun packages/db/scripts/load-seed.ts data/seeds/covid-lab-leak.json

# 2. the chat session (so the transcript replays in the app)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres \
  bun packages/db/scripts/load-session.ts data/seeds/covid-lab-leak.session.json
```

Both loaders are idempotent (`onConflictDoNothing`). Open the room and the graph
renders with receipts; open the chat and eve's investigation replays. Verified
round-trip: delete → reload → the session streams the full transcript.

## Export another

```sh
DATABASE_URL=... bun packages/db/scripts/export-investigation.ts <sessionId> [out.json]   # graph
DATABASE_URL=... bun packages/db/scripts/export-session.ts     <sessionId> [out.session.json]  # chat
```

## Notes & caveats

- **Fresh store for the session.** The chat exporter dumps *all* workflow runs
  (eve stores no queryable session→turn link), so load the `.session.json` into
  a workflow store dedicated to this seed, not one already holding other live
  investigations.
- **Entry run status.** eve sessions stay "running" to accept more turns; the
  export preserves that. On reload the transcript replays read-only; continuing
  the conversation from a loaded session is untested.
- The graph seed anonymizes human contributors (`displayName: "Anonymous"`).
