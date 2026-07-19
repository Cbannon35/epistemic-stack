---
name: scout
description: >-
  How to open an investigation: pin the question's terms and scope, lay out an
  explicit agenda of exploration avenues, fan out a wide, diverse set of
  searches across them (stances, disciplines, entities, time, and the queries
  different kinds of people would run), then record a set of competing
  hypotheses grounded in what the scout surfaced. Use at the start of every new
  question, before deep research — breadth first, so the hypothesis set and the
  evidence base don't collapse into the consensus answer.
---

# Scout: open the question wide before researching it deep

**Input:** a raw question from the room. **Output:** an operationalized question, a
stated exploration agenda, a diverse batch of executed searches, and 3–6 recorded
competing hypotheses. This is the front half of the loop; deep per-source processing
comes after.

The failure mode this skill exists to prevent: searching the two obvious queries,
recording the two textbook hypotheses, and building the whole graph inside the
consensus basin. Breadth here is cheap; a missing hypothesis or angle later is not.

## Step 1 — Operationalize the question

Pin the terms and scope **before any search**, because hypotheses, deduplication, and
coverage all wobble on ambiguity.

- Restate the question in a precise, operationalized form — decidable where possible
  (a yes/no, or a small set of candidate answers).
- Define every load-bearing or ambiguous term. For "Did COVID originate from a lab
  leak?" fix what counts as a "lab leak" (engineered pathogen vs. natural-strain
  accident vs. field-collection infection), the pathogen/time window, and what would
  count as *resolving* it.
- Note scope boundaries (what's in / out).

Do NOT answer the question or take a side — you are fixing definitions, not
investigating. Share the operationalized form with the room in one short beat (it's
also the moment a misunderstanding gets caught cheaply) — as plain chat text, then
keep going. NEVER use the `ask_question` tool: this app has no way to answer it and
the turn will hang. If the room disagrees with your framing, they'll say so in chat.

Then check the commons (`query_commons`) with the operationalized terms — unless the
turn context carries a `commonsPolicy` of "fresh-start".

## Step 2 — Lay out the exploration agenda (avenues)

Before any searching, enumerate the **avenues**: the distinct domains of
consideration that bear on the question — where evidence could come from, not what
the answer might be. For "should the US end military aid to Chad": alliance
architecture, counterterror operations, petrostate/oil-revenue dynamics,
great-power substitution, humanitarian second-order effects, Chadian domestic
politics. For "are eggs good for you": LDL/cholesterol response, hard outcomes
(CVD, mortality), nutrient density, population subgroups, dose and dietary context.

- **State the agenda to the room in plain chat** before searching — it is the
  contract for what "explored" means on this question, and the moment a missing
  avenue gets caught cheaply.
- Scale it: a policy or contested question deserves 4–8 avenues; a narrow factual
  question may need only one or two (then skip the ceremony and just say so).
- Avenues are search commitments. Every avenue you name must either get queries in
  the fan-out below or be explicitly deferred out loud — never silently dropped.

## Step 3 — Base fan-out: wide, diverse search queries

Produce the **widest, most diverse set of search queries** you can to seed the
investigation — the goal is breadth and reaching the long tail, NOT the single
consensus answer. The agenda's avenues are the backbone: **every avenue gets at
least one query**, and the other axes vary within and across them:

- **Stance** — queries that would surface the case for each candidate answer and the
  uncertain/underdetermined view. Explicitly include the strongest case for the
  *less popular* answer (avoid the consensus basin).
- **Disciplines** — the different fields that would study this (e.g. for COVID
  origins: virology, genomics, epidemiology, intelligence/forensics, sociology of
  science, policy).
- **Key entities** — specific people, institutions, places, datasets, events involved.
- **Time / reference class** — historical precedents and base rates ("how were past
  outbreak origins determined").

Make each query a concrete, searchable string (terms you'd actually type), not a
vague prompt. Favor diversity over redundancy.

## Step 4 — Perspective fan-out (the queries different people would run)

This runs IN ADDITION to the base fan-out. Its job is to add the queries that fall
out of **thinking as different kinds of people** — angles a neutral voice tends to
miss. Sketch a handful of *types of person/expert* who would investigate this
differently, varied across:

- **Discipline / expertise** — e.g. virologist, biosafety regulator, forensic
  analyst, science journalist, policy scholar.
- **Stance** — include perspectives inclined toward each answer and toward
  "underdetermined"; explicitly include a credible advocate for the less popular
  answer.
- **Proximity** — insiders (practitioners) and outsiders (skeptics, generalists,
  affected laypeople) reason differently; include both.

For each persona, note what it cares about and 2–3 concrete queries *it* would run —
terms salient to *them*, including at least one aimed at evidence challenging the
popular answer. Keep the personas that add queries the base fan-out didn't already
produce; drop the rest.

## Step 5 — Run the scout and enumerate hypotheses

Execute the combined query set — `search_sources` for scholarly angles, `search_web`
for debates, journalism, institutional and non-traditional material — narrating as
you go ("Searching OpenAlex for…", naming the avenue each query serves). Skim the
results as **scout material**: you are mapping the space, not yet extracting claims.

Then record 3–6 **competing hypotheses** with `record_hypothesis` — the poles the
evidence gets organized around. Avenues are where you *looked*; hypotheses are what
the answer *could be* — claims from every avenue will attach to the same poles.
Match their form to the kind of question:

- **Contested single-fact questions** (origins, causal disputes, predictions):
  near-MECE *mechanisms/explanations* (e.g. for COVID: engineered-then-leaked;
  natural-strain lab accident; zoonotic spillover via wildlife trade), not a bare
  yes/no — plus an "unresolvable / underdetermined" hypothesis when the evidence
  may not settle it.
- **Decision / policy questions** ("should X do Y"): the candidate *positions*,
  including conditional ones (end aid / continue as-is / restructure with
  conditions). Non-obvious positions often emerge from an avenue — that's why
  hypotheses come after the sweep.
- **Broad evaluative questions** ("is X good for you"): competing *summary
  positions over the evidence*, with explicitly conditional/heterogeneous ones as
  first-class hypotheses ("net-neutral for most adults; adverse for LDL
  hyperresponders"). "It depends" is a real answer — do not conflate it with
  "unresolvable."

In every form: mutually exclusive and jointly covering the plausible space, grounded
in the scout material (include non-obvious poles it surfaced, not just the textbook
two), and tagged with **`answer_bearing`** — the verdict each implies for the
operationalized question. Several hypotheses can share a verdict (for "is the LHC
dangerous?", "can't produce a black hole", "it evaporates", and "stable but
harmless" all bear "no").

## Scale and pacing

Scale the fan-out to the question: a contested, multi-disciplinary question deserves
the full spread (roughly 8–12 queries across steps 3–4); a narrow factual question
needs a few. This is a chat, not a batch job — narrate the angles you're covering,
and if the room redirects you mid-scout, follow the room.

Carry the agenda forward: the avenues you declared are what the final report must
account for, avenue by avenue — covered, thin, or empty (see the loop's Report
step). An avenue that produced nothing is a finding, not a formatting problem.

**Hand-off:** with hypotheses recorded, proceed to deep research — read the best
sources the scout surfaced, extract claims (`extract-claims`), relate them, and link
each to the hypotheses it bears on.
