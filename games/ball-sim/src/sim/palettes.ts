/**
 * Color ramps for walls and rings. Moderate saturation, readable on the
 * neutral graphite ground. Sampled with deterministic math only.
 */
export const PALETTES: Record<string, string[]> = {
  aurora: ['#5EEAD4', '#60A5FA', '#A78BFA', '#F472B6'],
  sunset: ['#FDBA74', '#FB7185', '#E879F9', '#818CF8'],
  ocean: ['#67E8F9', '#38BDF8', '#6366F1', '#A855F7'],
  ember: ['#FDE68A', '#FB923C', '#F43F5E', '#BE185D'],
  meadow: ['#BEF264', '#4ADE80', '#2DD4BF', '#22D3EE'],
  candy: ['#F9A8D4', '#C4B5FD', '#93C5FD', '#99F6E4'],
  prism: ['#F87171', '#FBBF24', '#34D399', '#60A5FA', '#C084FC', '#F87171'],
  titanium: ['#E5E9EE', '#9AA4B1', '#C9D0D8', '#7D8794'],
  // Two-tone pairs for densely striped ring stacks.
  'duo-dusk': ['#4F7CFF', '#FF8A3D'],
  'duo-mint': ['#2DD4BF', '#F472B6'],
  'duo-sun': ['#A78BFA', '#FCD34D'],
  'duo-ice': ['#38BDF8', '#F43F5E'],
};

export const PALETTE_NAMES = Object.keys(PALETTES);

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Color at t in [0,1] along a palette. */
export function samplePalette(name: string, t: number): string {
  const p = PALETTES[name] ?? PALETTES.aurora;
  const x = Math.max(0, Math.min(1, t)) * (p.length - 1);
  const i = Math.min(p.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(p[i]), b = hexToRgb(p[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
