import { CTX_SELF, CTX_OTHER, CTX_POINT, CTX_TETHER } from '@engine/index';

/** Shape level for a context mask. The built-in masks form a chain, so more corners = more information. */
export function level(mask: number): number {
  if (mask < 0) return 0;
  if (mask & CTX_TETHER) return 4;
  if (mask & CTX_OTHER) return 3;
  if (mask & CTX_POINT) return 2;
  if (mask & CTX_SELF) return 1;
  return 0;
}

export function describeMask(mask: number): string {
  if (mask < 0) return 'Needs objects wired in';
  const parts: string[] = [];
  if (mask & CTX_SELF) parts.push('self');
  if (mask & CTX_OTHER) parts.push('other');
  if (mask & CTX_POINT) parts.push('point');
  if (mask & CTX_TETHER) parts.push('tether');
  return parts.length ? parts.join(', ') : 'no context';
}

const NS = 'http://www.w3.org/2000/svg';

function poly(n: number, r: number, rot = 0): string {
  const pts: string[] = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (k * Math.PI * 2) / n;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** SVG glyph for a port: 'obj' for object ports, or an event shape level 0-4. */
export function portGlyph(kind: 'obj' | number, size = 14): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '-7 -7 14 14');
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute('class', 'shape');
    svg.append(el);
    return el;
  };
  if (kind === 'obj') {
    add('circle', { r: '5' });
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '1.8');
    dot.setAttribute('fill', 'var(--cat)');
    svg.append(dot);
    return svg;
  }
  switch (kind) {
    case 0: add('circle', { r: '4.5' }); break;
    case 1: add('rect', { x: '-4.2', y: '-4.2', width: '8.4', height: '8.4', rx: '0.8' }); break;
    case 2: add('polygon', { points: poly(4, 5.8) }); break;
    case 3: add('polygon', { points: poly(3, 6, 0) }); break;
    default: add('polygon', { points: starPts() }); break;
  }
  return svg;
}

function starPts(): string {
  const pts: string[] = [];
  for (let k = 0; k < 8; k++) {
    const r = k % 2 ? 2.6 : 6;
    const a = -Math.PI / 2 + (k * Math.PI) / 4;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return pts.join(' ');
}

export const CAT_COLOR: Record<string, string> = {
  object: 'var(--cat-object)',
  trigger: 'var(--cat-trigger)',
  filter: 'var(--cat-filter)',
  action: 'var(--cat-action)',
};
