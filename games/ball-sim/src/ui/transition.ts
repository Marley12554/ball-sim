import { h } from './dom';
import { audio } from './audio';

/**
 * Entering a simulation: the card's live preview lifts off the page and
 * expands to fill the screen, a bloom of the sim's color washes outward and a
 * grid sweeps past, then the real sim takes over underneath.
 */
interface Pending { rect: DOMRect; color: string; snapshot: HTMLCanvasElement | null }
let pending: Pending | null = null;

export function prepareEnter(from: HTMLElement, color: string, canvas: HTMLCanvasElement | null): void {
  let snapshot: HTMLCanvasElement | null = null;
  if (canvas && canvas.width > 0) {
    snapshot = document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext('2d')!.drawImage(canvas, 0, 0);
  }
  pending = { rect: from.getBoundingClientRect(), color, snapshot };
}

export function hasPendingEnter(): boolean {
  return pending !== null;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run the entry over `stage`. `reveal` is called at the peak of the flash. */
export function playEnter(stage: HTMLElement, reveal: () => void, done: () => void): void {
  const p = pending;
  pending = null;
  if (!p || reduced()) {
    stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    reveal();
    done();
    return;
  }
  audio.enter();
  const W = window.innerWidth, H = window.innerHeight;
  const r = p.rect;
  const portal = h('div', { class: 'portal' });
  if (p.snapshot) {
    p.snapshot.className = 'portal-snap';
    portal.append(p.snapshot);
  }
  const flash = h('div', { class: 'portal-flash', style: { '--c': p.color } as any });
  const grid = h('div', { class: 'portal-grid' });
  const layer = h('div', { class: 'portal-layer' }, portal, grid, flash);
  document.body.append(layer);

  const inset = `inset(${r.top}px ${W - r.right}px ${H - r.bottom}px ${r.left}px round 16px)`;
  // Square preview scaled to cover the screen.
  const side = Math.max(W, H);
  portal.style.width = `${side}px`;
  portal.style.height = `${side}px`;
  portal.style.left = `${(W - side) / 2}px`;
  portal.style.top = `${(H - side) / 2}px`;
  const s0 = r.width / side;
  const tx0 = r.left + r.width / 2 - W / 2, ty0 = r.top + r.height / 2 - H / 2;
  const ease = 'cubic-bezier(.75,0,.15,1)';
  portal.animate([
    { transform: `translate(${tx0}px, ${ty0}px) scale(${s0})`, borderRadius: `${16 / s0}px`, filter: 'brightness(1)' },
    { transform: `translate(${tx0 * 0.15}px, ${ty0 * 0.15}px) scale(${s0 * 1.08 + 0.1})`, filter: 'brightness(1.4)', offset: 0.45 },
    { transform: 'translate(0,0) scale(1.06)', borderRadius: '0px', filter: 'brightness(2.2)' },
  ], { duration: 720, easing: ease, fill: 'forwards' });
  layer.animate([{ clipPath: inset }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], { duration: 640, easing: ease, fill: 'forwards' });
  grid.animate([
    { opacity: 0, transform: 'scale(0.4)' },
    { opacity: 0.55, transform: 'scale(1)', offset: 0.5 },
    { opacity: 0, transform: 'scale(1.6)' },
  ], { duration: 900, delay: 260, easing: 'ease-out', fill: 'forwards' });
  flash.animate([
    { opacity: 0, transform: 'scale(0.2)' },
    { opacity: 1, transform: 'scale(1)', offset: 0.55 },
    { opacity: 0, transform: 'scale(1.5)' },
  ], { duration: 900, delay: 340, easing: 'ease-in-out', fill: 'forwards' });
  setTimeout(() => {
    reveal();
    portal.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
  }, 720);
  setTimeout(() => {
    layer.remove();
    done();
  }, 1300);
}
