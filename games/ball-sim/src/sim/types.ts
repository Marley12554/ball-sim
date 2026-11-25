import type { GraphDef } from '@engine/index';

export type Look =
  | { t: 'solid'; c: string }
  | { t: 'gradient'; c: string[]; kind: 'linear' | 'radial'; angle: number }
  | { t: 'pattern'; p: PatternKind; c: [string, string]; scale: number; angle: number }
  | { t: 'flag'; code: string }
  | { t: 'image'; asset: string }
  /** The boss: a grinning imp face, drawn in code. */
  | { t: 'imp' };

export type PatternKind = 'stripes' | 'dots' | 'checker' | 'split' | 'rings' | 'quarters';

export type LookPreset = 'random' | 'countries' | 'palette' | 'gradients' | 'patterns' | 'spectrum' | 'images';

export type LookSetting =
  | { mode: 'fixed'; look: Look }
  | { mode: 'preset'; preset: LookPreset };

export interface SimSettings {
  gravityMode: 'linear' | 'point';
  /** units/s^2 */
  gravity: number;
  /** degrees, 90 = down */
  gravityAngle: number;
  clock: 'none' | 'up' | 'down';
  clockFrom: number;
  /** Visible half-size in world units. 0 = fit to contents. */
  view: number;
  maxObjects: number;
  speedLimit: number;
  /** Seconds after the outcome before a looping preview restarts. */
  endHold: number;
  /** Seconds everything holds still in its starting pose before the sim begins. */
  startDelay: number;
  /** 'fit' frames everything. 'follow' trails the first ball with a lazy camera. */
  camera: 'fit' | 'follow';
  /** Fraction of ball overlap pushed apart per step (1 = hard, lower lets crowds compress). */
  pairCorrection: number;
  /** Impacts slower than this don't bounce, so piles settle. */
  restThreshold: number;
}

export interface SimDef {
  v: 1;
  name: string;
  seed: number;
  settings: SimSettings;
  graph: GraphDef;
  /** Uploaded images, id -> data URL. */
  assets?: Record<string, string>;
}

export const DEFAULT_SETTINGS: SimSettings = {
  gravityMode: 'linear',
  gravity: 0,
  gravityAngle: 90,
  clock: 'none',
  clockFrom: 60,
  view: 0,
  maxObjects: 5000,
  speedLimit: 3000,
  endHold: 4,
  startDelay: 1.5,
  camera: 'fit',
  pairCorrection: 1,
  restThreshold: 30,
};

/** Things that happened this step, for the renderer and audio. Not part of the simulation state. */
export type Fx =
  | { k: 'bounce'; x: number; y: number; s: number; r: number; l: number }
  | { k: 'hit'; x: number; y: number; s: number; r: number; l: number }
  | { k: 'shatter'; x: number; y: number; color: string; arcs: number[]; segs: number[]; n: number }
  | { k: 'boom'; x: number; y: number; big: boolean }
  | { k: 'burst'; x: number; y: number; r: number; color: string }
  | { k: 'clank'; x: number; y: number; s: number }
  | { k: 'pop'; x: number; y: number; l: number }
  | { k: 'fall'; x: number; y: number }
  | { k: 'pickup'; x: number; y: number; kind: string }
  | { k: 'damage'; x: number; y: number; amount: number; blocked: boolean }
  | { k: 'zap'; x: number; y: number; x2: number; y2: number }
  | { k: 'clash'; x: number; y: number }
  | { k: 'swallow'; x: number; y: number; n: number }
  | { k: 'end'; label: string };

/** Event passed through trigger chains. Entity refs: body handle >= 0, collider -(id+2), zone -(ZONE_BASE+i+2). */
export interface SimEvent {
  self: number;
  other: number;
  px: number;
  py: number;
  nx: number;
  ny: number;
  tether: number;
  speed: number;
}

export const NONE = -1;
export const ZONE_BASE = 10_000_000;
export const isBody = (r: number) => r >= 0;
export const isZone = (r: number) => r <= -(ZONE_BASE + 2);
export const isCollider = (r: number) => r <= -2 && r > -(ZONE_BASE + 2);
export const colliderRef = (id: number) => -(id + 2);
export const colliderOf = (r: number) => -r - 2;
export const zoneRef = (i: number) => -(ZONE_BASE + i + 2);
export const zoneOf = (r: number) => -r - 2 - ZONE_BASE;
