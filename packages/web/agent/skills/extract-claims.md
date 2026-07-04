# Skill: extract-claims

Turn a source into single, standalone, sourced claims — the atoms of the commons.

## When to use

After reading a source (an abstract or a passage) and deciding it bears on the question.

## Method

1. Identify each distinct assertion the passage makes that bears on the question.
2. Rewrite each as ONE standalone sentence — no "it"/"this", no bundling two ideas with
   "and". A reader must understand it without the surrounding text.
3. Capture the VERBATIM quote from the source that supports it. If the source doesn't
   actually say it, drop the claim.
4. Tag it: discipline, position (which side it supports), evidence_type
   (empirical / testimony / modeling / review), era.
5. Call `record_source` once for the source, then `record_claim` for each claim (passing
   the `source_id` + the `quote`).

## What counts as the same claim (dedup)

`record_claim` dedups by meaning automatically. Two statements are the SAME claim only if
they make the same point, in the same direction, with the same caveats. Keep distinct:

- "X" vs "not X" (opposite direction) — different claims.
- "eggs raise cholesterol" vs "eggs raise cholesterol only at high intake" — the caveat
  makes them different; record both.

The tool returns `is_new=false` when it merges an incoming claim into an existing one —
that is the "many sources, one claim" signal, and it is expected and good.

## Don't

- Don't record your own synthesis or summaries as claims — only what a source asserts.
- Don't record a claim without a verbatim quote.
