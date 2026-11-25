type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, any>;

/** Minimal element builder. on* attrs become listeners, class/style/dataset handled. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

const ICONS: Record<string, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>',
  edit: '<path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  record: '<circle cx="12" cy="12" r="6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  undo: '<path d="M9 7L5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
  redo: '<path d="M15 7l4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h2"/>',
  more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  expand: '<path d="M14 5h5v5M10 19H5v-5M19 5l-6 6M5 19l6-6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5"/><path d="M5 19h14"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 19h14"/>',
  speed: '<path d="M5 17a8 8 0 1 1 14 0"/><path d="M12 13l4-4"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
  sliders: '<path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};

export function icon(name: string, size = 20): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return wrap.firstChild as SVGSVGElement;
}

export function iconButton(name: string, label: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `icon-btn ${cls}`, title: label, 'aria-label': label, onclick: onClick }, icon(name));
}

let toastTimer = 0;
export function toast(text: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 1800);
}

/** Simple popover menu anchored to a button. */
export function menu(anchor: HTMLElement, items: { label: string; icon?: string; onClick: () => void; danger?: boolean }[]): void {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h('div', { class: 'menu', role: 'menu' },
    ...items.map((it) => h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`, role: 'menuitem',
      onclick: () => { m.remove(); it.onClick(); },
    }, it.icon ? icon(it.icon, 16) : null, it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
  const close = (e: Event) => {
    if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener('pointerdown', close, true); }
  };
  setTimeout(() => document.addEventListener('pointerdown', close, true));
}

export function downloadFile(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
