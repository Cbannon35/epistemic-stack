# Epistemic-Stack — judge runbook

Submission to the FLF Epistemic Case Study Competition.
Paper: [`epistack.pdf`](./epistack.pdf) (built from `main.tex`).

- **Demo video:** _[LINK — TODO]_ — the `▶` boxes in the paper reference timestamps in this video.
- **Case-study data:** the three contest investigations (COVID-19 origins, LHC black holes, eggs) ship as committed seeds in `data/seeds/` — see **Load the case studies** below.

## What this is

An append-only, provenance-first claim graph ("the commons") built jointly by people and AI agents:

- **Deep research runs** whose discipline is enforced in code, not prompts: coverage quotas per evidence avenue, verbatim quote-in-source verification, and an adversarial pressure-test/probe wave over every recorded claim.
- **A multiplayer platform** with GitHub mechanics for knowledge: fork, merge request (reviewed scope adoption), citable versioned releases with a JSON export API — and external agents as first-class contributors over MCP.

## Run it locally (~5 minutes)

Prereqs: [Bun](https://bun.sh), Node ≥ 24, Docker, [Supabase CLI](https://supabase.com/docs/guides/local-development).

```sh
bun install
supabase start            # local Postgres :54422 / API :54421
bun run db:migrate        # apply schema migrations

cd packages/web
cp .env.example .env      # then fill in:
#   NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SECRET_KEY  ← printed by `supabase start`
#   ANTHROPIC_API_KEY   ← powers eve (falls back to OPENAI_API_KEY)
#   TAVILY_API_KEY      ← web search; without it, research runs are structure-only

bun run dev               # app + eve agent, one process → http://localhost:3000
```

### Load the case studies

The three contest investigations ship as seeds in [`data/seeds/`](../data/seeds/) — committed
to the repo, full receipt trails included. Each has two halves: the claim graph and eve's
replayable chat session.

| Seed | Investigation | Graph |
| --- | --- | --- |
| `covid-lab-leak` | *Did COVID originate from a lab leak?* | 48 claims · 19 sources · 4 hypotheses · 64 links |
| `eggs` | *Are eggs good to eat?* | 22 claims · 22 sources · 3 hypotheses · 85 links |
| `cern-black-hole` | *Will CERN generate a black hole?* | 23 claims · 15 sources · 4 hypotheses · 37 links |

**Easiest:** in the running app, use **"Load sample data"** — it loads graph and chat together
and opens the room in one step.

**Or from the CLI**, after `supabase start` and `bun run db:migrate` (repo root, ideally a
fresh install — both loaders are idempotent):

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres \
  bun packages/db/scripts/load-seed.ts data/seeds/covid-lab-leak.json      # claim graph
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres \
  bun packages/db/scripts/load-session.ts data/seeds/covid-lab-leak.session.json  # chat replay
```

Open the room: the graph renders with receipts, and the chat replays eve's whole
investigation. `<name>-transcript.json` is a plain decoded transcript for reading outside the
app — not needed to load. See [`data/seeds/README.md`](../data/seeds/README.md) for caveats.

## What to try

1. **Follow a receipt.** Open a case-study investigation, click any claim in the graph, open its provenance panel: creation receipt (who/method/when), verbatim quotes per source, challenge threads, derived dispute state.
2. **Scrub belief.** Open a hypothesis: per-person credence timelines, community credence; use the time slider on the graph.
3. **Delegate a run of your own.** In any room, hand eve a brief on a sub-question you care about and watch the phases stream in: plan → research → read → pressure → probe → synthesize.
4. **Cut and consume a release.** Cut a release from the graph toolbar, open its public page, then hit `GET /api/releases/<id>/export` for the frozen machine-readable graph (with BibTeX citation). [`/releases`](http://localhost:3000/releases) is the public gallery — every release ever cut, grouped by investigation with versions stacked newest-first. Releases are readable over MCP too (`list_releases`, `get_release`), including without a key, so an agent can cite a frozen graph it had no hand in building.
5. **Connect your own agent.** Sidebar → "Connect an agent" → mint an `esk_` key, then point any MCP client at it:

```json
{ "mcpServers": { "epistack": {
    "url": "http://localhost:3000/api/mcp/agent/mcp",
    "headers": { "Authorization": "Bearer esk_..." } } } }
```

Your agent gets eve's own write path (`record_claim`, `file_challenge`, `send_message`, `delegate_investigation`, …) and shows up in the room's presence layer — avatar, live cursor — like any other member. Full tool reference: paper, Appendix A.

6. **Fork and merge.** Fork an investigation, add claims, open a merge request back; review the incoming-node preview and accept as the owner.

## Repo tour

| Where | What |
| --- | --- |
| `packages/web/lib/delegate/run.ts` | the delegated research state machine (quotas + quote checks in code) |
| `packages/web/agent/skills/` | the methodology as readable skills (scout, extract-claims, pressure-test) |
| `packages/web/agent/lib/commons.ts` | the single write path all contributors share (dedup + receipts) |
| `packages/web/lib/mcp/` | the agent MCP surface (read / write / collaborate bundles) |
| `packages/web/lib/merge.ts`, `lib/releases.ts`, `lib/investigations.ts` | fork/merge/release scope algebra |
| `packages/db/src/schema.ts` | the whole commons schema, invariants documented at the top |
| `docs/ARCHITECTURE.md` | subsystem-by-subsystem map |
