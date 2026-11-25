import { withDefaults } from '@engine/index';
import type { ParamSpec } from '@engine/index';
import { h, icon, iconButton } from '../dom';
import type { Editor } from './editor';
import { CAT_COLOR } from './ports';
import { colorField, numberField, segField, selectField, textField, toggleField } from './fields';
import { lookEditor, uploadImage } from './look';
import type { LookSetting } from '../../sim/types';

export function renderInspector(ed: Editor, el: HTMLElement): void {
  el.replaceChildren();
  const sel = ed.sel;
  if (sel?.kind === 'node') {
    const n = ed.def.graph.nodes.find((x) => x.id === sel.id);
    if (n) return nodeInspector(ed, el, n.id);
  }
  if (sel?.kind === 'wire') {
    const w = ed.def.graph.wires[sel.index];
    if (w) {
      const err = ed.analysis.wireError[sel.index];
      el.append(
        h('div', { class: 'i-head' }, h('div', { class: 'i-title' }, 'Wire'), h('div', { class: 'spacer' }), closeBtn(ed)),
        h('div', { class: 'field' }, h('label', null, 'From'), h('div', null, ed.labelOf(w.from))),
        h('div', { class: 'field' }, h('label', null, 'To'), h('div', null, ed.labelOf(w.to))),
      );
      if (err) el.append(h('div', { class: 'field' }, h('label', null, 'Problem'), h('div', { class: 'node-warn' }, wireProblem(err))));
      el.append(h('button', { class: 'btn danger-btn', onclick: () => ed.removeWire(sel.index) }, icon('trash', 16), 'Delete wire'));
      return;
    }
  }
  settingsInspector(ed, el);
}

function wireProblem(code: string): string {
  switch (code) {
    case 'shape': return 'This block needs more than the wire gives it.';
    case 'needs objects': return 'Wire some objects into the trigger first.';
    case 'loop': return 'Wires can’t loop back.';
    default: return 'These blocks don’t connect.';
  }
}

function closeBtn(ed: Editor) {
  return iconButton('close', 'Close', () => ed.select(null), 'sheet-close');
}

function nodeInspector(ed: Editor, el: HTMLElement, id: string): void {
  const n = ed.def.graph.nodes.find((x) => x.id === id)!;
  const spec = ed.reg.get(n.type);
  if (!spec) {
    el.append(h('div', { class: 'empty-hint' }, `Unknown block “${n.type}”.`));
    return;
  }
  const p = withDefaults(spec, n.params);
  const upstream = ed.upstreamMask(id);
  el.append(h('div', { class: 'i-head', style: { '--cat': CAT_COLOR[spec.category] } as any },
    h('div', null, h('div', { class: 'i-cat' }, spec.category), h('div', { class: 'i-title' }, spec.label)),
    h('div', { class: 'spacer' }),
    iconButton('copy', 'Duplicate block', () => ed.duplicateNode(id)),
    closeBtn(ed)));
  const main = spec.params.filter((ps) => ps.key !== 'cooldown' && ps.key !== 'maxFires');
  for (const ps of main) {
    if (ps.showIf && !ps.showIf(p)) continue;
    el.append(paramField(ed, id, ps, p[ps.key], upstream));
  }
  if (spec.category === 'trigger') {
    el.append(h('div', { class: 'i-sub' }, 'Limits'));
    for (const key of ['cooldown', 'maxFires']) {
      const ps = spec.params.find((x) => x.key === key)!;
      el.append(paramField(ed, id, ps, p[key], upstream));
    }
  }
  el.append(h('button', { class: 'btn danger-btn', onclick: () => ed.removeNode(id) }, icon('trash', 16), 'Delete block'));
}

function paramField(ed: Editor, id: string, ps: ParamSpec, value: any, upstream: number | null): HTMLElement {
  const set = (v: any, rerender: boolean) => ed.setParam(id, ps.key, v, rerender);
  switch (ps.type) {
    case 'number':
    case 'int':
    case 'angle':
      return numberField(ps.label, Number(value), { min: ps.min, max: ps.max, step: ps.step, unit: ps.unit, int: ps.type === 'int' },
        (v) => set(v, false), () => ed.commit());
    case 'enum':
      return segField(ps.label, String(value), (ps.options ?? []).map((o) => ({
        value: o.value, label: o.label,
        disabled: upstream !== null && o.needs !== undefined && (o.needs & upstream) !== o.needs && o.value !== value,
      })), (v) => set(v, true));
    case 'bool':
      return toggleField(ps.label, !!value, (v) => set(v, true));
    case 'text':
      return textField(ps.label, String(value ?? ''), (v) => set(v, false), () => ed.commit());
    case 'color':
      return colorField(ps.label, String(value ?? '#ffffff'), (v) => set(v, false), () => ed.commit());
    case 'ref': {
      const opts = ed.def.graph.nodes
        .filter((x) => {
          const s = ed.reg.get(x.type);
          return s?.category === 'object' && (!ps.refKinds || ps.refKinds.includes(s.kind ?? ''));
        })
        .map((x) => ({ value: x.id, label: ed.nameOf(x.id) }));
      if (ps.anyLabel) opts.unshift({ value: '', label: ps.anyLabel });
      return selectField(ps.label, String(value ?? ''), opts, ps.anyLabel ? null : 'Choose…', (v) => set(v, true));
    }
    case 'look': {
      const wrap = h('div', { class: 'field wide' }, h('label', null, ps.label));
      wrap.append(lookEditor({
        value: value as LookSetting,
        assets: ed.def.assets ?? {},
        onChange: (v, commit) => { ed.setParam(id, ps.key, v, false); if (commit) ed.commit(); },
        addAsset: (data) => ed.addAsset(data),
      }));
      return wrap;
    }
    default:
      return h('div');
  }
}

function settingsInspector(ed: Editor, el: HTMLElement): void {
  const s = ed.def.settings;
  const set = (k: keyof typeof s, v: any, rerender: boolean) => ed.setSetting(k, v, rerender);
  el.append(
    h('div', { class: 'i-head' }, h('div', null, h('div', { class: 'i-cat', style: { color: 'var(--muted)' } }, 'simulation'), h('div', { class: 'i-title' }, 'Settings')), h('div', { class: 'spacer' }), closeBtn(ed)),
    seedField(ed),
    segField('Gravity', s.gravityMode, [{ value: 'linear', label: 'Direction' }, { value: 'point', label: 'To center' }], (v) => set('gravityMode', v, true)),
    numberField('Strength', s.gravity, { min: -10000, max: 10000, step: 10 }, (v) => set('gravity', v, false), () => ed.commit()),
  );
  if (s.gravityMode === 'linear') el.append(numberField('Angle', s.gravityAngle, { min: -360, max: 360, step: 1, unit: '°' }, (v) => set('gravityAngle', v, false), () => ed.commit()));
  el.append(
    segField('Clock', s.clock, [{ value: 'none', label: 'Hidden' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }], (v) => set('clock', v, true)),
  );
  if (s.clock === 'down') el.append(numberField('From', s.clockFrom, { min: 1, max: 36000, step: 1, unit: 's' }, (v) => set('clockFrom', v, false), () => ed.commit()));
  el.append(
    h('div', { class: 'i-sub' }, 'Advanced'),
    numberField('View size', s.view, { min: 0, max: 10000, step: 10 }, (v) => set('view', v, false), () => ed.commit()),
    numberField('Max objects', s.maxObjects, { min: 16, max: 50000, step: 100, int: true }, (v) => set('maxObjects', v, false), () => ed.commit()),
    numberField('Speed limit', s.speedLimit, { min: 50, max: 20000, step: 50 }, (v) => set('speedLimit', v, false), () => ed.commit()),
  );
  const assets = ed.def.assets ?? {};
  el.append(h('div', { class: 'i-sub' }, 'Images'),
    h('div', { class: 'assets' },
      ...Object.keys(assets).map((id) => {
        const b = h('button', { class: 'asset', title: 'Remove image' }, h('img', { src: assets[id], alt: '' }));
        b.addEventListener('click', () => ed.removeAsset(id));
        return b;
      }),
      h('button', { class: 'asset', title: 'Upload image', style: { display: 'grid', placeItems: 'center', borderColor: 'var(--line-2)' }, onclick: () => uploadImage((d) => ed.addAsset(d)) }, icon('plus', 18))));
}

function seedField(ed: Editor): HTMLElement {
  const f = numberField('Seed', ed.def.seed, { min: 0, max: 4294967295, step: 1, int: true }, (v) => ed.setSeed(v, false), () => ed.commit());
  f.querySelector('.num')!.append(iconButton('dice', 'New seed', () => ed.setSeed((Math.random() * 1e6) | 0, true)));
  return f;
}
