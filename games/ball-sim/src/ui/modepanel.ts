import { h, icon, iconButton } from './dom';
import { Player, onTick } from './player';
import { LOOK_CODES, randomOf } from '../sim/modes';
import type { Generated, Mode } from '../sim/modes';
import { WEAPON_INFO, WEAPON_TYPES } from '../sim/arena';
import { navigate } from './router';
import { prepareEnter } from './transition';
import { audio } from './audio';

/**
 * Picking a mode: the card's preview zooms into a stage, a sidebar lists the
 * variants and ball looks, and the preview follows whatever is selected.
 */
export function openModePanel(mode: Mode, from: HTMLElement, color: string): void {
  document.querySelector('.mp-back')?.remove();
  let variant = 0;
  let look = '';
  let gen: Generated = randomOf(mode, variant, look);

  const canvas = h('canvas');
  const code = h('div', { class: 'mp-code mono' });
  const stage = h('div', { class: 'mp-stage' }, canvas, code);
  const player = new Player(canvas, gen.def, { hud: true, loop: true, budgetMs: 8, sound: false });
  const roll = () => {
    gen = randomOf(mode, variant, look);
    code.textContent = gen.code;
    return gen.def;
  };
  player.nextDef = roll;
  code.textContent = gen.code;
  const reload = () => player.load(roll());

  const variantList = h('div', { class: 'mp-variants' });
  const lookRow = h('div', { class: 'mp-looks' });
  const extra = h('div', { class: 'mp-extra' });
  const paint = () => {
    variantList.replaceChildren(...mode.variants.map((v, k) => h('button', {
      class: `mp-variant${k === variant ? ' on' : ''}`,
      onclick: () => { variant = k; reload(); paint(); },
    }, h('div', { class: 'mp-vname' }, v.name, k === 0 ? h('span', { class: 'mp-default' }, 'Default') : null), h('div', { class: 'mp-vdesc' }, v.desc))));
    lookRow.replaceChildren(...LOOK_CODES.map((l) => h('button', {
      class: `mp-chip${l.code === look ? ' on' : ''}`,
      onclick: () => { look = l.code; reload(); paint(); },
    }, l.label)));
    const weapons = mode.id === 'arena' && variant >= 4;
    extra.replaceChildren(...(weapons ? [
      h('div', { class: 'mp-label' }, 'Weapons'),
      h('div', { class: 'mp-weapons' }, ...WEAPON_TYPES.map((w) => {
        const info = WEAPON_INFO[w];
        return h('div', { class: 'mp-weapon' },
          h('div', { class: 'mp-wname' }, info.name),
          h('div', { class: 'mp-wdoes' }, info.does),
          h('div', { class: 'mp-wspecial' }, h('b', null, info.special), ` · ${info.specialDoes}`));
      })),
      h('p', { class: 'mp-note' }, 'Five hits fill a weapon’s meter and fire its special.'),
    ] : []));
  };
  paint();

  const close = () => {
    stopTick();
    back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-in' }).onfinish = () => back.remove();
    window.removeEventListener('keydown', onKey);
  };
  const watch = () => {
    prepareEnter(canvas, color, canvas);
    stopTick();
    back.remove();
    window.removeEventListener('keydown', onKey);
    navigate(`#/g/${gen.code}`);
  };
  const side = h('aside', { class: 'mp-side' },
    h('div', { class: 'mp-head' },
      h('div', null, h('div', { class: 'mp-kicker' }, h('i', { class: 'card-dot', style: { '--glow': color } as any }), 'Simulation'), h('div', { class: 'mp-title' }, mode.name)),
      iconButton('close', 'Close', close)),
    h('div', { class: 'mp-label' }, 'Variant'),
    variantList,
    h('div', { class: 'mp-label' }, 'Ball look'),
    lookRow,
    extra,
    h('div', { class: 'mp-actions' },
      h('button', { class: 'btn primary big', onclick: watch }, icon('play', 14), 'Watch'),
      h('button', { class: 'btn', title: 'New layout', onclick: reload }, icon('dice', 16)),
      h('button', { class: 'btn', onclick: () => { stopTick(); back.remove(); navigate(`#/edit/g:${gen.code}`); } }, icon('edit', 16), 'Edit a copy')),
  );
  const back = h('div', { class: 'mp-back', onclick: (e: MouseEvent) => { if (e.target === back) close(); } },
    h('div', { class: 'mp', style: { '--glow': color } as any }, stage, side));
  document.body.append(back);

  // Zoom the stage out of the card it came from.
  const r0 = from.getBoundingClientRect();
  const r1 = stage.getBoundingClientRect();
  if (r1.width > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const sx = r0.width / r1.width, sy = r0.height / r1.height;
    stage.animate([
      { transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) scale(${sx}, ${sy})`, borderRadius: '18px' },
      { transform: 'none' },
    ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    side.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 120, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    back.animate([{ backgroundColor: 'rgba(5,6,8,0)' }, { backgroundColor: 'rgba(5,6,8,0.72)' }], { duration: 400 });
  }
  audio.hover();
  const stopTick = onTick((dt) => player.frame(dt));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') watch();
  };
  window.addEventListener('keydown', onKey);
}
