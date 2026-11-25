import { Rng } from '@engine/index';
import { h, clear, icon, pickFile, toast } from '../dom';
import { drawLook, flagUrl, onImagesChanged } from '../../render/sprites';
import { COUNTRIES, LOOK_PRESETS, LookPicker, PALETTE, PATTERNS } from '../../sim/looks';
import type { Look, LookSetting, LookPreset } from '../../sim/types';
import { colorField, numberField, segField, selectField } from './fields';

export interface LookEditorOpts {
  value: LookSetting;
  assets: Record<string, string>;
  onChange: (v: LookSetting, commit: boolean) => void;
  addAsset: (dataUrl: string) => string;
}

function swatch(look: Look, assets: Record<string, string>, size = 40): HTMLCanvasElement {
  const c = h('canvas', { class: 'look-swatch', width: size * 2, height: size * 2, style: { width: `${size}px`, height: `${size}px` } });
  const paint = () => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    drawLook(g, look, c.width, assets);
  };
  paint();
  const off = onImagesChanged(() => { if (!c.isConnected) off(); else paint(); });
  return c;
}

function presetSample(p: LookPreset, assets: Record<string, string>): Look {
  const picker = new LookPicker({ mode: 'preset', preset: p }, new Rng(p.length * 7 + 3), Object.keys(assets), 6);
  return picker.next();
}

export function lookEditor(o: LookEditorOpts): HTMLElement {
  const root = h('div', { class: 'look-ed' });
  let value: LookSetting = structuredClone(o.value);
  let flagQuery = '';

  const emit = (commit: boolean) => o.onChange(structuredClone(value), commit);
  const fixed = (): Look => (value.mode === 'fixed' ? value.look : { t: 'solid', c: PALETTE[0] });

  const render = () => {
    clear(root);
    const current = value.mode === 'fixed' ? value.look : presetSample(value.preset, o.assets);
    root.append(
      h('div', { class: 'look-row' }, swatch(current, o.assets),
        h('div', { style: { flex: '1' } }, segField('', value.mode === 'fixed' ? 'fixed' : 'preset', [
          { value: 'preset', label: 'Preset' }, { value: 'fixed', label: 'Custom' },
        ], (m) => {
          value = m === 'fixed' ? { mode: 'fixed', look: { t: 'solid', c: PALETTE[0] } } : { mode: 'preset', preset: 'palette' };
          emit(true); render();
        }))),
    );
    // segField renders a label column. Hide it here.
    (root.querySelector('.look-row .field > label') as HTMLElement | null)?.remove();
    (root.querySelector('.look-row .field') as HTMLElement | null)?.classList.add('wide');

    if (value.mode === 'preset') {
      const cur = value.preset;
      root.append(h('div', { class: 'presets' }, ...LOOK_PRESETS.map((p) => h('button', {
        class: `preset-chip${p.value === cur ? ' on' : ''}`,
        onclick: () => { value = { mode: 'preset', preset: p.value }; emit(true); render(); },
      }, swatch(presetSample(p.value, o.assets), o.assets, 28), p.label))));
      return;
    }

    const look = fixed();
    const setLook = (l: Look, commit: boolean, rerender = false) => {
      value = { mode: 'fixed', look: l };
      emit(commit);
      if (rerender) render();
      else (root.querySelector('.look-swatch') as HTMLCanvasElement | null)?.replaceWith(swatch(l, o.assets));
    };
    root.append(segField('Type', look.t, [
      { value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }, { value: 'pattern', label: 'Pattern' },
      { value: 'flag', label: 'Flag' }, { value: 'image', label: 'Image' },
    ], (t) => {
      const c0 = look.t === 'solid' ? look.c : PALETTE[0];
      const next: Look =
        t === 'solid' ? { t: 'solid', c: c0 } :
        t === 'gradient' ? { t: 'gradient', c: [c0, PALETTE[6]], kind: 'linear', angle: 45 } :
        t === 'pattern' ? { t: 'pattern', p: 'stripes', c: [c0, '#F4F1EA'], scale: 2, angle: 45 } :
        t === 'flag' ? { t: 'flag', code: 'us' } :
        { t: 'image', asset: Object.keys(o.assets)[0] ?? '' };
      setLook(next, true, true);
    }));

    if (look.t === 'solid') {
      root.append(colorField('Color', look.c, (c) => setLook({ t: 'solid', c }, false), () => emit(true)));
    } else if (look.t === 'gradient') {
      root.append(
        colorField('From', look.c[0], (c) => setLook({ ...look, c: [c, look.c[1] ?? c] }, false), () => emit(true)),
        colorField('To', look.c[1] ?? look.c[0], (c) => setLook({ ...look, c: [look.c[0], c] }, false), () => emit(true)),
        segField('Kind', look.kind, [{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }], (k) => setLook({ ...look, kind: k as 'linear' | 'radial' }, true, true)),
      );
      if (look.kind === 'linear') root.append(numberField('Angle', look.angle, { min: -360, max: 360, step: 1, unit: '°' }, (a) => setLook({ ...look, angle: a }, false), () => emit(true)));
    } else if (look.t === 'pattern') {
      root.append(
        selectField('Pattern', look.p, PATTERNS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })), null, (p) => setLook({ ...look, p: p as typeof look.p }, true, true)),
        colorField('Base', look.c[0], (c) => setLook({ ...look, c: [c, look.c[1]] }, false), () => emit(true)),
        colorField('Ink', look.c[1], (c) => setLook({ ...look, c: [look.c[0], c] }, false), () => emit(true)),
        numberField('Scale', look.scale, { min: 1, max: 6, step: 1, int: true }, (s) => setLook({ ...look, scale: s }, false), () => emit(true)),
        numberField('Angle', look.angle, { min: -360, max: 360, step: 1, unit: '°' }, (a) => setLook({ ...look, angle: a }, false), () => emit(true)),
      );
    } else if (look.t === 'flag') {
      const search = h('input', { class: 'text-in flag-search', type: 'search', placeholder: 'Search countries', value: flagQuery });
      const list = h('div', { class: 'flag-list' });
      const fill = () => {
        const q = flagQuery.trim().toLowerCase();
        list.replaceChildren(...COUNTRIES.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code === q).map((c) =>
          h('button', { class: c.code === look.code ? 'on' : '', title: c.name, onclick: () => setLook({ t: 'flag', code: c.code }, true, true) },
            h('img', { src: flagUrl(c.code), alt: c.name, loading: 'lazy' }))));
      };
      search.addEventListener('input', () => { flagQuery = search.value; fill(); });
      fill();
      root.append(search, list);
    } else if (look.t === 'image') {
      const ids = Object.keys(o.assets);
      root.append(h('div', { class: 'assets' },
        ...ids.map((id) => h('button', { class: `asset${id === look.asset ? ' on' : ''}`, onclick: () => setLook({ t: 'image', asset: id }, true, true) },
          h('img', { src: o.assets[id], alt: '' }))),
        h('button', { class: 'asset', title: 'Upload image', style: { display: 'grid', placeItems: 'center', borderColor: 'var(--line-2)' }, onclick: async () => {
          const id = await uploadImage(o.addAsset);
          if (id) setLook({ t: 'image', asset: id }, true, true);
        } }, icon('plus', 18))));
    }
  };
  render();
  return root;
}

/** Pick an image, center-crop to a square, downscale to 128px. Returns the new asset id. */
export async function uploadImage(addAsset: (dataUrl: string) => string): Promise<string | null> {
  const f = await pickFile('image/*');
  if (!f) return null;
  try {
    const url = URL.createObjectURL(f);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const S = 128;
    const c = h('canvas', { width: S, height: S });
    const g = c.getContext('2d')!;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, S, S);
    URL.revokeObjectURL(url);
    let data = c.toDataURL('image/webp', 0.82);
    if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
    return addAsset(data);
  } catch {
    toast('Couldn’t read that image');
    return null;
  }
}
