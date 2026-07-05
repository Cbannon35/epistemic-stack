// Lens visual language, shared by the graph panel, control, and diff panel.

// Comparison poles: lens A leans blue, lens B leans amber.
export const LENS_A_COLOR = "#2563eb";
export const LENS_B_COLOR = "#d97706";

// Trust score → node opacity. Discounted nodes fade but never vanish — the
// lens weighs the record, it doesn't erase it.
export function opacityForScore(score: number): number {
  return 0.22 + 0.78 * Math.min(1, Math.max(0, score));
}

export function divergenceOutline(delta: number): string {
  const color = delta > 0 ? LENS_A_COLOR : LENS_B_COLOR;
  const strength = Math.round((0.25 + 0.75 * Math.abs(delta)) * 100);
  return `color-mix(in oklab, ${color} ${strength}%, transparent)`;
}
