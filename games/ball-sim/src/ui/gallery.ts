import { h, icon, iconButton, menu, pickFile, toast } from './dom';
import { Player, onTick, simMeta } from './player';
import { PRESETS } from '../sim/presets';
import { loadSims, deleteSim, saveSim, newId, normalize } from './store';
import type { SimDef } from '../sim/types';
import { navigate } from './router';

export function mountGallery(root: HTMLElement): () => void {
  const players: { p: Player; visible: boolean; meta: HTMLElement; outcome: HTMLElement }[] = [];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const pl = players.find((x) => x.p.canvas === en.target);
      if (pl) pl.visible = en.isIntersecting;
    }
  }, { rootMargin: '100px' });

  const card = (def: SimDef, href: string, mine?: { id: string }) => {
    const canvas = h('canvas');
    const meta = h('div', { class: 'card-meta' });
    const outcome = h('div', { class: 'card-outcome' });
    const el = h('a', { class: 'card', href },
      canvas, outcome,
      h('div', { class: 'card-body' }, h('div', { class: 'card-title' }, def.name), meta));
    if (mine) {
      const more = iconButton('more', 'More', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu(more, [
          { label: 'Edit', icon: 'edit', onClick: () => navigate(`#/edit/${mine.id}`) },
          { label: 'Duplicate', icon: 'copy', onClick: () => { saveSim(newId(), { ...def, name: `${def.name} copy` }); render(); } },
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => { deleteSim(mine.id); render(); toast('Deleted'); } },
        ]);
      }, 'card-more');
      el.append(more);
    }
    const p = new Player(canvas, def, { loop: true, budgetMs: 3, dprCap: 1.5 });
    meta.textContent = simMeta(p.sim);
    players.push({ p, visible: false, meta, outcome });
    io.observe(canvas);
    return el;
  };

  const page = h('div', { class: 'gallery' });
  const render = () => {
    for (const x of players) io.unobserve(x.p.canvas);
    players.length = 0;
    const mine = loadSims();
    page.replaceChildren(h('div', { class: 'gallery-inner' },
      h('div', { class: 'top' },
        h('div', { class: 'wordmark' }, h('span', { class: 'dot' }), 'Ball Sim'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: importFile }, icon('upload', 16), 'Import'),
        h('button', { class: 'btn primary', onclick: () => navigate('#/edit/new') }, icon('plus', 16), 'New simulation')),
      mine.length ? h('div', { class: 'section-label' }, 'Yours') : null,
      mine.length ? h('div', { class: 'grid' }, ...mine.map((s) => card(s.def, `#/m/${s.id}`, { id: s.id }))) : null,
      h('div', { class: 'section-label' }, 'Presets'),
      h('div', { class: 'grid' }, ...PRESETS.map((p) => card(p.make(), `#/p/${p.id}`))),
    ));
  };

  async function importFile() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const def = normalize(JSON.parse(await f.text()));
      const id = newId();
      saveSim(id, def);
      navigate(`#/m/${id}`);
    } catch {
      toast('That file isn’t a simulation');
    }
  }

  render();
  root.replaceChildren(page);
  const stop = onTick((dt) => {
    for (const x of players) {
      if (!x.visible) continue;
      x.p.frame(dt);
      const o = x.p.sim.outcome;
      x.outcome.textContent = o ? o.label : '';
      x.outcome.classList.toggle('show', !!o);
    }
  });
  return () => { stop(); io.disconnect(); };
}
