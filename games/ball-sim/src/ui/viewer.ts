import { h, icon, iconButton, toast, downloadFile } from './dom';
import { Player, onTick } from './player';
import type { SimDef } from '../sim/types';
import { encodeShare, shareUrl, copyText } from './store';
import { navigate } from './router';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export interface ViewerOptions {
  def: SimDef;
  /** Route to open the editor for this sim. */
  editHref: string;
}

export function mountViewer(root: HTMLElement, o: ViewerOptions): () => void {
  const def = structuredClone(o.def);
  const canvas = h('canvas');
  const player = new Player(canvas, def, { hud: true, budgetMs: 12, hudTop: 44 });

  const playBtn = iconButton('pause', 'Pause', () => togglePlay());
  const speedChip = h('button', { class: 'chip', title: 'Speed', onclick: () => cycleSpeed() }, '1×');
  const seedChip = h('button', { class: 'chip', title: 'Seed', onclick: () => toggleSeed() }, `seed ${def.seed}`);
  const recBtn = iconButton('record', 'Record', () => toggleRecord());
  const stats = h('div', { class: 'v-stats' });
  const recDot = h('div', { class: 'rec-dot', style: { display: 'none' } });
  let seedPop: HTMLElement | null = null;

  const overlay = h('div', { class: 'overlay' },
    h('div', { class: 'v-top' },
      iconButton('back', 'Back to gallery', () => navigate('#/')),
      h('div', { class: 'v-title' }, def.name),
      stats),
    h('div', { class: 'v-bar' },
      playBtn,
      iconButton('restart', 'Restart', () => player.restart()),
      speedChip,
      h('div', { class: 'sep' }),
      seedChip,
      iconButton('dice', 'New seed', () => setSeed((Math.random() * 1e6) | 0)),
      h('div', { class: 'sep' }),
      iconButton('edit', 'Edit', () => navigate(o.editHref)),
      iconButton('link', 'Copy link', () => share()),
      recBtn),
  );
  const page = h('div', { class: 'viewer' }, canvas, overlay, recDot);
  root.replaceChildren(page);

  /* Idle fade */
  let idleTimer = 0;
  const wake = () => {
    overlay.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => { if (!seedPop) overlay.classList.add('idle'); }, 2600);
  };
  page.addEventListener('pointermove', wake);
  page.addEventListener('pointerdown', wake);
  wake();

  function togglePlay() {
    player.setPaused(!player.paused);
    playBtn.replaceChildren(icon(player.paused ? 'play' : 'pause'));
    playBtn.title = player.paused ? 'Play' : 'Pause';
  }
  function cycleSpeed() {
    const i = SPEEDS.indexOf(player.speed);
    player.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
    speedChip.textContent = `${player.speed}×`;
  }
  function setSeed(seed: number) {
    def.seed = seed >>> 0;
    seedChip.textContent = `seed ${def.seed}`;
    player.load(def);
  }
  function toggleSeed() {
    if (seedPop) { seedPop.remove(); seedPop = null; return; }
    const input = h('input', { type: 'number', value: String(def.seed), inputmode: 'numeric' });
    const apply = () => { setSeed(Number(input.value) || 0); seedPop?.remove(); seedPop = null; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') toggleSeed(); });
    seedPop = h('div', { class: 'seed-pop' }, input, h('button', { class: 'btn', onclick: apply }, 'Run'));
    overlay.append(seedPop);
    input.focus();
    input.select();
  }
  async function share() {
    const url = shareUrl(await encodeShare(def));
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
      downloadFile(`${def.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'simulation'}.${ext}`, new Blob(chunks, { type: mime }));
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
    else if (e.key === 'Escape') navigate('#/');
  };
  window.addEventListener('keydown', onKey);

  let statT = 0;
  const stop = onTick((dt) => {
    player.frame(dt);
    statT += dt;
    if (statT > 0.25) {
      statT = 0;
      const w = player.sim.world;
      const slow = player.runner.overloaded && !player.paused;
      stats.replaceChildren(
        slow ? h('span', { class: 'slow' }, `${player.runner.effectiveSpeed.toFixed(2)}×`) : '',
        h('span', null, `${w.aliveCount} balls`),
      );
      if (rec) recDot.textContent = `${((performance.now() - recStart) / 1000).toFixed(0)}s`;
    }
  });

  return () => {
    stop();
    rec?.stop();
    clearTimeout(idleTimer);
    window.removeEventListener('keydown', onKey);
  };
}
