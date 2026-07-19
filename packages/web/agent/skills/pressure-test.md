---
name: pressure-test
description: >-
  Given a claim, produce a list of concrete questions to research whose answers
  would shed light on whether the claim is true. Works by reading the claim as a
  chain — what's true anyway, the driver, the in-between steps, the stakes — and
  probing each joint with a fixed set of plain-English tests, so the output is a
  ready-to-investigate research list rather than a verdict. Use when
  pressure-testing a load-bearing recorded claim to find its hidden assumptions
  and generate the cruxes that drive residual uncertainty. Works for causal,
  policy, evaluative, predictive, and (more narrowly) factual claims.
---

# Pressure-Test a Claim

**Input:** a claim. **Output:** a numbered list of concrete questions to research — each one a question whose answer would shed light on whether the claim is true.

The job isn't to agree or disagree, and it isn't to deliver a verdict. It's to lay out
what the claim quietly depends on and turn each dependency into a researchable question,
so the claim can be checked instead of just accepted. Steps 1–3 are how you generate the
questions; the list is what you return.

Two ideas run underneath:

- **Weakening vs. reversing.** A finding that merely *weakens* a step makes it shakier;
  a finding that *reverses* shows the conclusion points the other way. Both are worth a
  question, so at each joint ask not only "what would make this shaky?" but "what would
  flip it?"
- Every dependency becomes a **question**, and the answer cuts both ways: an answer
  against the claim weakens (or reverses) it, an answer for it strengthens it. Note that
  direction so the reader knows what each answer would mean.

## Step 1 — Lay the claim out as a chain

Most contestable claims (anything with a *because* or a *so what*) break into four parts:

- **What's true anyway** — the baseline, what would be the case without the thing in
  question. This is what lets you say the thing is *responsible* for anything. Easy to
  skip, and skipping it is the most common mistake.
- **The driver** — the claim that the thing actually does the relevant first step. Pure
  connection: does it set this chain in motion at all?
- **The in-between steps** — the "and then… and then…" that carries the driver to the
  stakes. State them separately; each has to hold.
- **The stakes** — the outcome that makes anyone care, plus how much it actually matters.

Then register what *kind* of claim it is, because that decides which lenses fire and so
how long the list is:

- *Causal / policy / predictive* ("X causes / will cause Y") — the full chain applies;
  every lens below can generate questions.
- *Evaluative* ("X is good / better") — the chain runs through a standard of comparison;
  the value-flip and side-effect lenses matter most.
- *Near-factual / origin* ("the cause of X was A, not B") — the chain is thin and the
  "stakes" node just restates the conclusion. Expect only the **baseline** and
  **real-reason** lenses to fire, and the reversal lenses to idle. The list will be
  shorter and concentrated there.

## Step 2 — Turn each joint into a question (what would weaken or strengthen it)

Walk the chain. Each lens that applies yields one or more research questions.

- **At the driver — "Does it actually connect?"** Maybe the thing doesn't do the first
  step at all. *(It doesn't connect.)*
- **At the baseline — "Would this have happened anyway?"** If the outcome shows up with
  or without the thing, the thing isn't doing the work. A common version: *does something
  else get there first?* *(It happens anyway.)*
- **At the mechanism — "Is the stated reason the real reason?"** Even if the outcome is
  real, a *different* cause might explain it — so the specific *because* is wrong even if
  the conclusion is right. *(Something else explains it.)*
- **At the stakes — "Is this as big as claimed, and does the last step really follow?"**
  The outcome may be overstated, or the final step may not reliably produce it. *(It's not
  that big, or it won't follow.)*

An answer against the claim weakens that joint; a confirming answer strengthens it. A
question about an *independent* path that reaches the stakes another way also belongs
here — its answer tells you whether the claim survives any single step failing.

## Step 3 — Add the questions that could flip the bottom line

These are the strongest challenges. Each one, where it applies, is worth a question.

- **"Does the thing do the opposite?"** Not just failing to help — actively producing the
  reverse outcome. The driver runs backward. *(Gate: only a real flip if the baseline
  leaves room — you can't push a door already shut. If the world is already where the
  reversal would push it, this collapses to ordinary weakening, so the question should
  also ask what the baseline already says.)*
- **"Is the outcome actually good the other way?"** Grant the chain, but ask whether the
  endpoint is desirable where the claim treated it as bad, or vice versa — flipping the
  *value*, not the facts.
- **"Does the same action cause a separate harm that outweighs the benefit?"** Grant the
  chain *and* its value, but ask what *else* the action sets off on another axis, and how
  big that cost is. This one doesn't make the claim false — it bears on whether the thing
  is *worth it*, not whether it's *true*, so label it that way. (And a separate harm is
  its own little chain — include a "would it happen anyway?" question for it too.)

For a near-factual claim these usually don't apply; don't force them.

## Output

Return a **numbered list of concrete, researchable questions** — each specific enough to
actually go look up, run, or investigate (not "consider whether…"). Generate them from
Steps 1–3: every lens that fires contributes one or more.

After each question, add a short note on what an answer would imply for the claim —
*weakens / strengthens / reverses / a cost that bears on whether it's worth doing rather
than whether it's true*. That note is what ties the question to the claim's truth value.

Keep the list to questions that actually have purchase on this claim; a near-factual
claim yields a short list concentrated in the baseline and real-reason lenses. You may
precede the list with the one-line chain if it helps the reader, but the list is the
deliverable. Plain questions, plain list — no diagram, no rigid template.

Then go research the highest-value questions with `search_sources` (and `search_web`
where the evidence is non-academic). The questions that remain open after research are
the cruxes that drive residual uncertainty — record each with `record_crux` (the
question, tied to the claim, plus what resolving it would imply as the `implication`),
and surface them to the user.

## Worked example

**Claim: "The new highway will reduce traffic congestion."**

*Scaffold (the chain):* baseline = current congestion and whether it's already easing;
driver = the highway adds capacity; in-between = more capacity → more throughput →
congestion drops; stakes = shorter commutes, and how much that's worth.

*Questions to research:*

1. Where is the current bottleneck, and does the new highway add capacity at that point
   or somewhere else? → if it bypasses the real chokepoint, weakens (doesn't connect).
2. Was congestion already trending down before the project — from remote work, a parallel
   transit line, population shifts? → if yes, the highway earns less credit, weakens
   (it happens anyway).
3. If congestion drops after it opens, what else changed at the same time (fuel prices, a
   rail line opening) that could explain the drop? → an alternative cause weakens the
   "because the highway" specifically.
4. In comparable cities, how much does peak-hour throughput actually improve per lane
   added? → small measured gains weaken the stakes.
5. Is there latent travel demand in this corridor that added capacity would release
   (induced demand)? → strong latent demand means congestion could end up equal or worse
   (a reversal); weak latent demand means this doesn't apply — so this question also tests
   its own gate.
6. How large are the side effects of the added capacity — induced driving, emissions,
   sprawl, displacement — relative to the commute time saved, and would that sprawl have
   happened anyway? → a large separate cost doesn't make "congestion drops" false, but
   bears on whether building it is worth it.

A confirming answer to 1–4 (capacity hits the real bottleneck, congestion wasn't already
falling, no other cause fits, big measured gains) strengthens the claim by the same
amount.

## Notes

- The list scales with the claim: a throwaway claim spawns two or three questions; a
  load-bearing one spawns the full set; a near-factual claim spawns a short list
  (baseline + real-reason).
- Lineage (optional): the four parts are *uniqueness / link / internal links / impact*;
  the weakening lenses are *no link / non-uniqueness (and "thumpers") / alternative
  causality / impact defense*; "does the opposite" is the *link turn* and "good the other
  way" the *impact turn*; "a separate harm that outweighs" is, in debate terms, a
  *disadvantage*; the gate is *uniqueness controlling the turn* — competitive-debate
  argument structure, translated out of the jargon.
