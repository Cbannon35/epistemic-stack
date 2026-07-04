# Skill: pressure-test

Given a claim, produce concrete, researchable questions whose answers would change our
mind about it. The output is a research list, not a verdict.

## Method

Read the claim as a chain and probe each joint with plain tests:

1. **Baseline** — "Would this have happened anyway?" (the most-missed test).
2. **Driver** — "Does the thing actually connect / set the chain in motion?"
3. **Mechanism** — "Is the stated reason the real reason, or does something else explain it?"
4. **Stakes** — "Is this as big as claimed, and does the last step follow?"

Then add the flips (the strongest challenges):

- "Does it do the OPPOSITE?" — the driver runs backward (only a real flip if the baseline
  leaves room).
- "Is the outcome good the OTHER way?" — flip the value, not the facts.
- "Does the same action cause a separate harm that outweighs the benefit?" — bears on
  whether it's worth it, not whether it's true.

## Output

A numbered list of concrete, researchable questions, each noting what an answer would
imply: weakens / strengthens / reverses / a cost. Scale to the claim — a throwaway claim
spawns 2–3 questions; a load-bearing one spawns the full set. Then go research the
highest-value ones with `search_sources`, and surface the still-open ones to the user as
the cruxes that drive residual uncertainty.
