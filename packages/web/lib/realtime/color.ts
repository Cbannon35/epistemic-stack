// Deterministic per-user cursor colors, tuned to the app's muted oklch
// palette. Violet is reserved for the eve tour cursor; the four graph accent
// hues (violet/green/red/amber) are avoided so people never read as edges.

export const HUES = [25, 60, 95, 175, 210, 250, 320, 350] as const;

function fnv1a(input: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return hash >>> 0;
}

/** The palette hue for a user — also names their ::highlight(comment-h<hue>). */
export function hueForUser(userId: string): number {
  return HUES[fnv1a(userId) % HUES.length];
}

export function colorForUser(userId: string): string {
  return `oklch(0.62 0.14 ${hueForUser(userId)})`;
}

export const EVE_COLOR = "#7c3aed";

/** Delegated-investigation eve cursors: kin to eve's violet, clearly not it. */
export const DELEGATE_COLOR = "#c026d3";

export function initialsFor(displayName: string): string {
  const parts = displayName.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
