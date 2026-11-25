import { h, icon, iconButton, toast, downloadFile } from './dom';
import { Player, onTick } from './player';
import type { SimDef } from '../sim/types';
import { encodeShare, shareUrl, copyText } from './store';
import { navigate } from './router';
import { playEnter } from './transition';
import { soundButton } from './sound';
import { audio } from './audio';
import { openCode } from './codes';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export interface ViewerOptions {
  def: SimDef;
  title: string;
  /** Short code for generated sims, if any. */
  code?: string;
  editHref: string;
  /** Make a fresh random sim (dice button). */
  reroll?: () => void;
}

export function mountViewer(root: HTMLElement, o: ViewerOptions): () => void {
  const def = structuredClone(o.def);
  const canvas = h('canvas');
  const player = new Player(canvas, def, { hud: true, budgetMs: 12, hudTop: 48, sound: true });

  const playBtn = iconButton('pause', 'Pause', () => togglePlay());
  const speedBtn = h('button', { class: 'chip', title: 'Speed' }, '1×', icon('chevron', 14));
  const stats = h('div', { class: 'v-stats' });
  const recDot = h('div', { class: 'rec-dot', style: { display: 'none' } });
  const recBtn = iconButton('record', 'Record a clip', () => toggleRecord());

  const spawnInline = h('div', { class: 'spawn-row hide-narrow' },
    ...[1, 2, 5, 10].map((n) => h('button', { class: 'chip spawn', title: `Add ${n}`, onclick: () => spawn(n) }, `+${n}`)),
    customSpawn());
  const spawnMore = h('button', { class: 'chip show-narrow', title: 'Add balls' }, icon('plus', 16));
  spawnMore.addEventListener('click', () => popup(spawnMore, (close) => h('div', { class: 'pop-grid' },
    ...[1, 2, 5, 10].map((n) => h('button', { class: 'chip spawn', onclick: () => { spawn(n); } }, `+${n}`)),
    customSpawn(close))));
  speedBtn.addEventListener('click', () => popup(speedBtn, (close) => {
    const input = h('input', { class: 'pop-in', type: 'number', min: '0.05', max: '32', step: '0.05', value: String(player.speed), 'aria-label': 'Custom speed' });
    const set = (v: number) => { setSpeed(v); close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') set(Number(input.value) || 1); });
    return h('div', { class: 'pop-list' },
      ...SPEEDS.slice().reverse().map((sp) => h('button', { class: `pop-item${sp === player.speed ? ' on' : ''}`, onclick: () => set(sp) }, `${sp}×`)),
      h('div', { class: 'pop-custom' }, input, h('button', { class: 'chip', onclick: () => set(Number(input.value) || 1) }, 'Set')));
  }));

  const codeChip = h('button', { class: 'chip code-chip', title: 'Code' }, o.code ?? `seed ${def.seed}`);
  codeChip.addEventListener('click', () => popup(codeChip, (close) => {
    const input = h('input', { class: 'pop-in wide', type: 'text', placeholder: 'Enter a code', spellcheck: false, 'aria-label': 'Code' });
    const go = () => { if (input.value.trim()) { close(); openCode(input.value.trim()); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'pop-list' },
      h('button', { class: 'pop-item', onclick: async () => { await share(); close(); } }, icon('link', 16), o.code ? 'Copy link to this sim' : 'Copy link'),
      o.code ? h('button', { class: 'pop-item', onclick: async () => { if (await copyText(o.code!)) toast('Code copied'); close(); } }, icon('copy', 16), `Copy ${o.code}`) : null,
      h('div', { class: 'pop-custom' }, input, h('button', { class: 'chip', onclick: go }, 'Open')));
  }, 'down'));

  const overlay = h('div', { class: 'overlay' },
    h('div', { class: 'v-top' },
      iconButton('back', 'Back', () => { audio.leave(); navigate('#/'); }),
      h('div', { class: 'v-title' }, o.title),
      codeChip,
      h('div', { class: 'spacer' }),
      stats,
      soundButton()),
    h('div', { class: 'v-bar' },
      playBtn,
      iconButton('restart', 'Restart', () => player.restart()),
      speedBtn,
      h('div', { class: 'sep' }),
      spawnInline,
      spawnMore,
      h('div', { class: 'sep' }),
      o.reroll ? iconButton('dice', 'Another one', () => o.reroll!()) : null,
      iconButton('edit', 'Edit', () => navigate(o.editHref)),
      recBtn),
  );
  const page = h('div', { class: 'viewer' }, canvas, overlay, recDot);
  root.replaceChildren(page);


  /* Idle fade */
  let idleTimer = 0;
  const wake = () => {
    overlay.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => { if (!document.querySelector('.pop')) overlay.classList.add('idle'); }, 2800);
  };
  page.addEventListener('pointermove', wake);
  page.addEventListener('pointerdown', wake);

  overlay.style.opacity = '0';
  canvas.style.opacity = '0';
  playEnter(page, () => { canvas.style.opacity = '1'; }, () => { overlay.style.opacity = ''; wake(); });

  function customSpawn(after?: () => void) {
    const input = h('input', { class: 'pop-in tiny', type: 'number', min: '1', max: '500', placeholder: '#', 'aria-label': 'How many to add' });
    const add = () => { const n = Math.round(Number(input.value)); if (n > 0) { spawn(Math.min(500, n)); input.value = ''; after?.(); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return h('div', { class: 'spawn-custom' }, input, h('button', { class: 'chip spawn', title: 'Add', onclick: add }, icon('plus', 14)));
  }
  function spawn(n: number) {
    if (player.sim.spawnExtra(n) === 0) toast('This one has no balls to add');
  }
  function togglePlay() {
    player.setPaused(!player.paused);
    playBtn.replaceChildren(icon(player.paused ? 'play' : 'pause'));
    playBtn.title = player.paused ? 'Play' : 'Pause';
  }
  function setSpeed(v: number) {
    const sp = Math.max(0.05, Math.min(32, v));
    player.setSpeed(sp);
    speedBtn.replaceChildren(`${Number(sp.toFixed(2))}×`, icon('chevron', 14));
  }
  async function share() {
    const url = o.code ? `${location.origin}${location.pathname}#/g/${o.code}` : shareUrl(await encodeShare(def));
    if (await copyText(url)) toast('Link copied');
    else prompt('Copy this link', url);
  }

  /* Recording */
  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let recStart = 0;
  function toggleRecord() {
    if (rec) { rec.stop(); return; }
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) { toast('Recording isn’t supported in this browser'); return; }
    const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const type = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    try {
      rec = new MediaRecorder(canvas.captureStream(60), type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined);
    } catch {
      toast('Recording isn’t supported in this browser');
      return;
    }
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const mime = rec?.mimeType || type || 'video/webm';
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      downloadFile(`${(o.code ?? def.name).replace(/[^\w-]+/g, '-').toLowerCase() || 'simulation'}.${ext}`, new Blob(chunks, { type: mime }));
      rec = null;
      recBtn.replaceChildren(icon('record'));
      recBtn.classList.remove('on');
      recDot.style.display = 'none';
      toast('Clip saved');
    };
    rec.start(250);
    recStart = performance.now();
    recBtn.replaceChildren(icon('stop'));
    recBtn.classList.add('on');
    recDot.style.display = '';
  }

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); wake(); }
    else if (e.key === 'r' || e.key === 'R') { player.restart(); wake(); }
    else if (e.key === 'Escape') { if (document.querySelector('.pop')) closePops(); else navigate('#/'); }
    else if (e.key === '+' || e.key === '=') spawn(1);
  };
  window.addEventListener('keydown', onKey);

  let statT = 0;
  const stop = onTick((dt) => {
    player.frame(dt);
    statT += dt;
    if (statT > 0.25) {
      statT = 0;
      const slow = player.runner.overloaded && !player.paused;
      stats.replaceChildren(
        slow ? h('span', { class: 'slow', title: 'Running slower to keep up' }, `${player.runner.effectiveSpeed.toFixed(2)}×`) : '',
        h('span', null, `${player.sim.countAllBalls()} balls`),
      );
      if (rec) recDot.textContent = `${((performance.now() - recStart) / 1000).toFixed(0)}s`;
    }
  });

  return () => {
    stop();
    rec?.stop();
    closePops();
    clearTimeout(idleTimer);
    window.removeEventListener('keydown', onKey);
  };
}

/* ------------------------------ Pop-ups ------------------------------ */

function closePops() {
  document.querySelectorAll('.pop').forEach((p) => p.remove());
}

/** A small panel growing out of a button (upward by default). */
function popup(anchor: HTMLElement, content: (close: () => void) => HTMLElement, dir: 'up' | 'down' = 'up') {
  const existing = document.querySelector('.pop') as HTMLElement | null;
  if (existing && (existing as any)._anchor === anchor) { existing.remove(); return; }
  closePops();
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
  const pop = h('div', { class: `pop ${dir}` }, content(close));
  (pop as any)._anchor = anchor;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
  pop.style.left = `${left}px`;
  pop.style.top = dir === 'up' ? `${r.top - ph - 10}px` : `${r.bottom + 10}px`;
  pop.style.setProperty('--ax', `${r.left + r.width / 2 - left}px`);
  const outside = (e: Event) => { if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  (pop.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
}
