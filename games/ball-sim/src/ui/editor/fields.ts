import { h } from '../dom';

export interface NumOpts {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  int?: boolean;
}

function decimals(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/**
 * Number field with a scrubbable label: drag the label left/right to change
 * the value (shift for fine steps), or type into the box.
 */
export function numberField(label: string, value: number, o: NumOpts, onInput: (v: number) => void, onCommit: () => void): HTMLElement {
  const step = o.step ?? (o.int ? 1 : 0.1);
  const dec = o.int ? 0 : decimals(step);
  const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
  const fmt = (v: number) => (o.int ? String(Math.round(v)) : String(Number(v.toFixed(Math.max(dec, 0)))));
  const input = h('input', { type: 'text', inputmode: 'decimal', value: fmt(value), spellcheck: false });
  let cur = value;
  const set = (v: number, fromTyping = false) => {
    v = clamp(o.int ? Math.round(v) : Number(v.toFixed(dec + 2)));
    cur = v;
    if (!fromTyping) input.value = fmt(v);
    onInput(v);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(v)) set(v, true);
  });
  input.addEventListener('change', () => { input.value = fmt(cur); onCommit(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
      onCommit();
    } else if (e.key === 'Enter') input.blur();
  });
  const lab = h('label', null, label);
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lab.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const v0 = cur;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 2) moved = true;
      const fine = ev.shiftKey ? 0.1 : 1;
      // Bigger values scrub faster so huge ranges stay usable.
      const mag = Math.max(step, Math.abs(v0) * 0.01);
      set(v0 + Math.round(dx / 3) * Math.max(step, mag >= step * 10 ? mag : step) * fine);
    };
    const up = () => {
      lab.removeEventListener('pointermove', move);
      lab.removeEventListener('pointerup', up);
      lab.removeEventListener('pointercancel', up);
      if (moved) onCommit();
      else input.focus();
    };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
    lab.addEventListener('pointercancel', up);
  });
  return h('div', { class: 'field scrub' }, lab,
    h('div', { class: 'num' }, input, o.unit ? h('span', { class: 'unit' }, o.unit) : null));
}

export function segField(label: string, value: string, options: { value: string; label: string; disabled?: boolean }[], onChange: (v: string) => void): HTMLElement {
  const short = options.length <= 4 && options.every((o) => o.label.length <= 12);
  if (!short) {
    const sel = h('select', { class: 'sel-in' }, ...options.map((o) => h('option', { value: o.value, disabled: o.disabled, selected: o.value === value }, o.label)));
    sel.addEventListener('change', () => onChange(sel.value));
    return h('div', { class: 'field' }, h('label', null, label), sel);
  }
  const seg = h('div', { class: 'seg' }, ...options.map((o) => h('button', {
    class: o.value === value ? 'on' : '', disabled: o.disabled, onclick: () => onChange(o.value),
  }, o.label)));
  return h('div', { class: 'field' }, h('label', null, label), seg);
}

export function selectField(label: string, value: string, options: { value: string; label: string }[], placeholder: string | null, onChange: (v: string) => void): HTMLElement {
  const sel = h('select', { class: `sel-in${!value && placeholder ? ' unset' : ''}` },
    placeholder ? h('option', { value: '', selected: !value, disabled: true }, placeholder) : null,
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, h('label', null, label), sel);
}

export function toggleField(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const t = h('button', { class: `toggle${value ? ' on' : ''}`, role: 'switch', 'aria-checked': String(value), 'aria-label': label });
  t.addEventListener('click', () => {
    const v = !t.classList.contains('on');
    t.classList.toggle('on', v);
    t.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return h('div', { class: 'field' }, h('label', null, label), h('div', null, t));
}

export function textField(label: string, value: string, onInput: (v: string) => void, onCommit: () => void): HTMLElement {
  const input = h('input', { class: 'text-in', type: 'text', value, spellcheck: false });
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('change', onCommit);
  return h('div', { class: 'field' }, h('label', null, label), input);
}

export function colorField(label: string, value: string, onInput: (v: string) => void, onCommit: () => void): HTMLElement {
  const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff' });
  const text = h('input', { class: 'text-in', type: 'text', value, spellcheck: false });
  pick.addEventListener('input', () => { text.value = pick.value; onInput(pick.value); });
  pick.addEventListener('change', onCommit);
  text.addEventListener('change', () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) { pick.value = text.value; onInput(text.value); onCommit(); }
    else text.value = pick.value;
  });
  return h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'color-in' }, pick, text));
}
