import type { GraphDef } from '@engine/index';

export type Look =
  | { t: 'solid'; c: string }
  | { t: 'gradient'; c: string[]; kind: 'linear' | 'radial'; angle: number }
  | { t: 'pattern'; p: PatternKind; c: [string, string]; scale: number; angle: number }
  | { t: 'flag'; code: string }
  | { t: 'image'; asset: string };

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
};

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
