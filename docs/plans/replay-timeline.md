# Replay timeline overhaul

The ↺ replay slider scrubs wall-clock time, so real investigations replay as
bursts separated by dead air, and arrivals blink in with no ceremony.

## Changes

1. **Density-aware scrubber** (`graph/time-slider.tsx` rewrite): the track is
   a 72-bin activity histogram over [min, max] — empty bins near-transparent,
   active bins darken with contribution count (foreground alpha, no color).
   A real `<input type="range">` stays layered invisibly on top as the
   interaction surface (drag + arrow keys + aria), with `focus-within` ring on
   the track. A playhead line + future-dimming overlay mark the current cap.
2. **Hover tooltip**: pointer position → timestamp (Intl.DateTimeFormat) and
   that bucket's count ("3 added"), clamped inside the bar.
3. **Event-time playback**: ▶ steps through the DISTINCT contribution
   timestamps instead of sweeping wall-clock — dwell 700ms per step plus
   150ms per extra simultaneous arrival (capped 2s), so dead periods are
   skipped entirely. Scrubbing pauses playback. Reaching the end returns the
   graph to live (brief hold, then exits replay).
4. **Arrival animation**: `.graph-node` gets a `node-arrive` mount keyframe —
   scale 0.85→1 + fade, 250ms `--ease-spring`, `backwards` fill so the hover
   transform transition regains ownership after entry. Transform/opacity only;
   the global prefers-reduced-motion rule disables it automatically. Applies
   to replay arrivals, tier expands, and live contributions alike.
5. **graph-panel**: one added memo (sorted unique timestamps across nodes +
   edges) passed as a new `timestamps` prop — no other changes, siblings are
   working in the same file.

## Punted

- Edge arrival animation (SVG stroke draw-in) — edges still appear instantly.
- Bin-level click-to-jump (the range input already covers it).
