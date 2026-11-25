import type { SimDef } from '../sim/types';
import { DEFAULT_SETTINGS } from '../sim/types';

export interface SavedSim {
  id: string;
  def: SimDef;
  updated: number;
}

const KEY = 'ballsim.sims.v1';

export function loadSims(): SavedSim[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedSim[]) : [];
    return list.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

function writeSims(list: SavedSim[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function getSim(id: string): SavedSim | undefined {
  return loadSims().find((s) => s.id === id);
}

export function saveSim(id: string, def: SimDef): boolean {
  const list = loadSims().filter((s) => s.id !== id);
  list.push({ id, def, updated: Date.now() });
  return writeSims(list);
}

export function deleteSim(id: string): void {
  writeSims(loadSims().filter((s) => s.id !== id));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Normalize anything that looks like a SimDef (imports, old shares). */
export function normalize(def: any): SimDef {
  if (!def || typeof def !== 'object' || !def.graph || !Array.isArray(def.graph.nodes)) throw new Error('Not a simulation file');
  return {
    v: 1,
    name: String(def.name ?? 'Untitled'),
    seed: Number(def.seed) >>> 0,
    settings: { ...DEFAULT_SETTINGS, ...(def.settings ?? {}) },
    graph: { nodes: def.graph.nodes, wires: Array.isArray(def.graph.wires) ? def.graph.wires : [] },
    assets: def.assets ?? {},
  };
}

/* ---------------------------- Share codes ---------------------------- */

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes]).stream().pipeThrough(stream as any);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Compact share code: "z" + base64url(deflate(json)), or "j" + base64url(json) without compression support. */
export async function encodeShare(def: SimDef): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(def));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return 'z' + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
    } catch { /* fall through */ }
  }
  return 'j' + toB64Url(json);
}

export async function decodeShare(code: string): Promise<SimDef> {
  const kind = code[0];
  const bytes = fromB64Url(code.slice(1));
  const json = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return normalize(JSON.parse(new TextDecoder().decode(json)));
}

export function shareUrl(code: string): string {
  return `${location.origin}${location.pathname}#/s/${code}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
