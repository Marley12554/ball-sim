import countriesRaw from 'flag-icons/country.json';
import type { Rng } from '@engine/index';
import type { Look, LookPreset, LookSetting, PatternKind } from './types';

interface CountryRow { code: string; name: string; iso: boolean }

export const COUNTRIES: { code: string; name: string }[] = (countriesRaw as CountryRow[])
  .filter((c) => c.iso)
  .map((c) => ({ code: c.code, name: c.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const countryName = new Map(COUNTRIES.map((c) => [c.code, c.name]));
export const nameOfCountry = (code: string) => countryName.get(code) ?? code.toUpperCase();

/** Curated palette: saturated but not neon, reads well on the dark ground. */
export const PALETTE = [
  '#FF5A1F', '#FFB020', '#F2E14C', '#7BD88F', '#2EC4B6', '#4CC9F0',
  '#4D7CFE', '#9B6BFF', '#E85DFF', '#FF5C8A', '#F4F1EA', '#8FA3B8',
];

export const PATTERNS: PatternKind[] = ['stripes', 'dots', 'checker', 'split', 'rings', 'quarters'];

export const LOOK_PRESETS: { value: LookPreset; label: string }[] = [
  { value: 'random', label: 'Anything' },
  { value: 'countries', label: 'Countries' },
  { value: 'palette', label: 'Colors' },
  { value: 'spectrum', label: 'Spectrum' },
  { value: 'gradients', label: 'Gradients' },
  { value: 'patterns', label: 'Patterns' },
  { value: 'images', label: 'Your images' },
];

function hsl(h: number, s: number, l: number): string {
  // Integer math only, no Math.* transcendental use. Produces #rrggbb.
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function pick<T>(rng: Rng, arr: T[]): T {
  return arr[rng.int(arr.length)];
}

function twoColors(rng: Rng): [string, string] {
  const a = rng.int(PALETTE.length);
  let b = rng.int(PALETTE.length - 1);
  if (b >= a) b++;
  return [PALETTE[a], PALETTE[b]];
}

/**
 * Picks looks for a stream of new objects. One instance per group, so
 * "countries" can avoid repeats until it runs out.
 */
export class LookPicker {
  private used = new Set<string>();
  private n = 0;
  constructor(private setting: LookSetting, private rng: Rng, private imageIds: string[], private total: number) {}

  next(): Look {
    const s = this.setting;
    const i = this.n++;
    if (s.mode === 'fixed') return s.look;
    return this.fromPreset(s.preset, i);
  }

  private fromPreset(p: LookPreset, i: number): Look {
    const rng = this.rng;
    switch (p) {
      case 'countries': {
        let pool = COUNTRIES.filter((c) => !this.used.has(c.code));
        if (pool.length === 0) { this.used.clear(); pool = COUNTRIES; }
        const c = pick(rng, pool);
        this.used.add(c.code);
        return { t: 'flag', code: c.code };
      }
      case 'palette':
        return { t: 'solid', c: pick(rng, PALETTE) };
      case 'spectrum': {
        const n = Math.max(1, this.total);
        return { t: 'solid', c: hsl(((i % n) * 360) / n, 0.78, 0.6) };
      }
      case 'gradients': {
        const [a, b] = twoColors(rng);
        return rng.chance(0.5)
          ? { t: 'gradient', c: [a, b], kind: 'linear', angle: rng.int(8) * 45 }
          : { t: 'gradient', c: [a, b], kind: 'radial', angle: 0 };
      }
      case 'patterns':
        return { t: 'pattern', p: pick(rng, PATTERNS), c: twoColors(rng), scale: 1 + rng.int(3), angle: rng.int(4) * 45 };
      case 'images':
        if (this.imageIds.length) return { t: 'image', asset: this.imageIds[i % this.imageIds.length] };
        return { t: 'solid', c: pick(rng, PALETTE) };
      case 'random':
      default: {
        const k = rng.int(4);
        if (k === 0) return this.fromPreset('countries', i);
        if (k === 1) return this.fromPreset('gradients', i);
        if (k === 2) return this.fromPreset('patterns', i);
        return this.fromPreset('palette', i);
      }
    }
  }
}

export function lookKey(l: Look): string {
  return JSON.stringify(l);
}

/** Display name for an object with this look. */
export function lookName(l: Look): string | null {
  return l.t === 'flag' ? nameOfCountry(l.code) : null;
}

/** A representative solid color (tethers, trails, HP arcs). */
export function lookColor(l: Look): string {
  switch (l.t) {
    case 'solid': return l.c;
    case 'gradient': return l.c[0];
    case 'pattern': return l.c[0];
    case 'flag': return FLAG_TINT[l.code] ?? '#E7E9EC';
    case 'image': return '#E7E9EC';
  }
}

// A few hand-picked tints for common flags. Others fall back to light gray
// until the renderer samples the real image.
const FLAG_TINT: Record<string, string> = {
  us: '#4D7CFE', gb: '#4D7CFE', fr: '#4D7CFE', de: '#FFB020', br: '#7BD88F', jp: '#FF5C8A',
  cn: '#FF5A1F', in: '#FFB020', it: '#7BD88F', es: '#FFB020', ca: '#FF5C8A', mx: '#7BD88F',
};

export const DEFAULT_LOOK: LookSetting = { mode: 'fixed', look: { t: 'solid', c: '#F4F1EA' } };
