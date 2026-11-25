import { h, icon, iconButton, menu, toast } from './dom';
import { Player, onTick } from './player';
import { MODES, randomOf } from '../sim/modes';
import type { Generated, Mode } from '../sim/modes';
import { loadSims, deleteSim, saveSim, newId } from './store';
import type { SimDef } from '../sim/types';
import { navigate } from './router';
import { prepareEnter } from './transition';
import { openImagesModal } from './images';
import { soundButton } from './sound';
import { openCode } from './codes';
import { openModePanel } from './modepanel';

/** One accent per mode, used for the card glow and the entry bloom. */
export const MODE_COLOR: Record<string, string> = {
  'ring-escape': '#5EEAD4',
  leak: '#60A5FA',
  sledge: '#FB923C',
  spiral: '#F472B6',
  mitosis: '#4ADE80',
  arena: '#FF4D5E',
  tether: '#A78BFA',
  growth: '#FBBF24',
};

export function mountGallery(root: HTMLElement): () => void {
  interface Card { p: Player; visible: boolean; meta: HTMLElement; outcome: HTMLElement; gen?: Generated; mode?: Mode }
  const cards: Card[] = [];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const c = cards.find((x) => x.p.canvas === en.target);
      if (c) c.visible = en.isIntersecting;
    }
  }, { rootMargin: '120px' });

  const modeCard = (mode: Mode) => {
    const canvas = h('canvas');
    const meta = h('div', { class: 'card-meta' });
    const outcome = h('div', { class: 'card-outcome' });
    const color = MODE_COLOR[mode.id] ?? '#FFFFFF';
    const card: Card = { p: null as unknown as Player, visible: false, meta, outcome, mode };
    const el = h('button', { class: 'card', style: { '--glow': color } as any },
      h('div', { class: 'card-canvas' }, canvas, outcome),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, h('i', { class: 'card-dot' }), mode.name, h('span', { class: 'card-pick' }, icon('sliders', 14), 'Customize')),
        meta));
    const show = (g: Generated) => {
      card.gen = g;
      meta.replaceChildren(h('span', null, mode.variants[g.variant].name), h('span', { class: 'mono' }, g.code));
    };
    const first = randomOf(mode);
    card.p = new Player(canvas, first.def, { loop: true, budgetMs: 3, dprCap: 1.5, lite: true });
    show(first);
    // Each loop plays a new layout of the default variant.
    card.p.nextDef = () => { const g = randomOf(mode); show(g); return g.def; };
    el.addEventListener('click', () => openModePanel(mode, canvas, color));
    cards.push(card);
    io.observe(canvas);
    return el;
  };

  const savedCard = (def: SimDef, id: string) => {
    const canvas = h('canvas');
    const meta = h('div', { class: 'card-meta' }, h('span', null, 'Yours'), h('span', { class: 'mono' }, `seed ${def.seed}`));
    const outcome = h('div', { class: 'card-outcome' });
    const el = h('button', { class: 'card', style: { '--glow': '#E7E9EC' } as any },
      h('div', { class: 'card-canvas' }, canvas, outcome),
      h('div', { class: 'card-body' }, h('div', { class: 'card-title' }, h('i', { class: 'card-dot' }), def.name), meta));
    const more = iconButton('more', 'More', (e) => {
      e.stopPropagation();
      menu(more, [
        { label: 'Edit', icon: 'edit', onClick: () => navigate(`#/edit/${id}`) },
        { label: 'Duplicate', icon: 'copy', onClick: () => { saveSim(newId(), { ...def, name: `${def.name} copy` }); render(); } },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => { deleteSim(id); render(); toast('Deleted'); } },
      ]);
    }, 'card-more');
    el.append(more);
    el.addEventListener('click', () => { prepareEnter(canvas, '#E7E9EC', canvas); navigate(`#/m/${id}`); });
    const p = new Player(canvas, def, { loop: true, budgetMs: 3, dprCap: 1.5, lite: true });
    cards.push({ p, visible: false, meta, outcome });
    io.observe(canvas);
    return el;
  };

  const page = h('div', { class: 'gallery' });
  const render = () => {
    for (const c of cards) io.unobserve(c.p.canvas);
    cards.length = 0;
    const mine = loadSims();
    const codeIn = h('input', { class: 'code-in', type: 'text', placeholder: 'Enter a code', spellcheck: false, autocomplete: 'off', 'aria-label': 'Simulation code' });
    const go = () => { if (codeIn.value.trim()) openCode(codeIn.value.trim()); };
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    page.replaceChildren(h('div', { class: 'gallery-inner' },
      h('header', { class: 'top' },
        h('div', { class: 'wordmark' }, h('span', { class: 'mark' }), 'Ball Sim'),
        h('div', { class: 'spacer' }),
        h('div', { class: 'code-box' }, codeIn, h('button', { class: 'code-go', title: 'Open code', 'aria-label': 'Open code', onclick: go }, icon('back', 16))),
        h('button', { class: 'btn ghost', onclick: openImagesModal }, icon('upload', 16), h('span', { class: 'hide-phone' }, 'Your images')),
        soundButton(),
        h('button', { class: 'btn primary', onclick: () => navigate('#/edit/new') }, icon('plus', 16), h('span', { class: 'hide-phone' }, 'Build your own'))),
      h('div', { class: 'grid modes' }, ...MODES.map(modeCard)),
      mine.length ? h('div', { class: 'section-label' }, 'Yours') : null,
      mine.length ? h('div', { class: 'grid' }, ...mine.map((s) => savedCard(s.def, s.id))) : null,
    ));
  };

  render();
  root.replaceChildren(page);
  const stop = onTick((dt) => {
    for (const c of cards) {
      if (!c.visible) continue;
      c.p.frame(dt);
      const o = c.p.sim.outcome;
      c.outcome.textContent = o ? o.label : '';
      c.outcome.classList.toggle('show', !!o);
    }
  });
  return () => { stop(); io.disconnect(); };
}
