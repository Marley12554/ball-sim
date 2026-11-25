import { canConnect, withDefaults } from '@engine/index';
import type { NodeDef } from '@engine/index';
import { h, iconButton } from '../dom';
import type { Editor } from './editor';
import { CAT_COLOR, describeMask, level, portGlyph } from './ports';

const NODE_W = 196;
const SNAP = 10;
const NS = 'http://www.w3.org/2000/svg';

export class GraphView {
  readonly el: HTMLElement;
  private world: HTMLElement;
  private svg: SVGSVGElement;
  private nodeEls = new Map<string, HTMLElement>();
  private zoomLabel: HTMLElement;
  panX = 40;
  panY = 40;
  zoom = 1;
  private temp: SVGPathElement | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number; cx: number; cy: number; px: number; py: number } | null = null;

  constructor(private ed: Editor) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('g-wires');
    this.world = h('div', { class: 'g-world' });
    this.world.append(this.svg);
    this.zoomLabel = h('div', { class: 'g-zoom' }, '100%');
    this.el = h('div', { class: 'graph' }, this.world,
      h('div', { class: 'g-tools' },
        iconButton('fit', 'Fit to view', () => this.fit()),
        this.zoomLabel));
    this.bindCanvas();
  }

  /* ----------------------------- Rendering ----------------------------- */

  render(): void {
    for (const el of this.nodeEls.values()) el.remove();
    this.nodeEls.clear();
    for (const n of this.ed.def.graph.nodes) this.world.append(this.makeNode(n));
    this.drawWires();
    this.applyTransform();
  }

  updateNode(id: string): void {
    const old = this.nodeEls.get(id);
    const n = this.ed.def.graph.nodes.find((x) => x.id === id);
    if (!old || !n) return;
    const el = this.makeNode(n);
    old.replaceWith(el);
    this.drawWires();
  }

  /** Refresh port shapes and summaries after a graph change without rebuilding. */
  refreshAll(): void {
    this.render();
  }

  private makeNode(n: NodeDef): HTMLElement {
    const ed = this.ed;
    const spec = ed.reg.get(n.type);
    const cat = spec?.category ?? 'object';
    const params = spec ? withDefaults(spec, n.params) : n.params;
    const a = ed.analysis;
    const title = cat === 'object' ? params.name || spec?.label : spec?.label ?? n.type;
    let summary = '';
    try { summary = spec?.summary?.(params, (id) => ed.nameOf(id)) ?? ''; } catch { /* ignore */ }
    const warn = ed.nodeWarning(n);
    const el = h('div', {
      class: `node${ed.sel?.kind === 'node' && ed.sel.id === n.id ? ' sel' : ''}`,
      style: { left: `${n.x}px`, top: `${n.y}px`, '--cat': CAT_COLOR[cat] } as any,
      dataset: { id: n.id },
    },
      h('div', { class: 'node-head' }, h('span', { class: 'node-cat' }, cat === 'object' ? spec?.label ?? 'object' : cat)),
      h('div', { class: 'node-title' }, title),
      h('div', { class: `node-sum${warn ? ' node-warn' : ''}` }, warn || summary || ' '),
    );
    el.style.setProperty('--cat', CAT_COLOR[cat]);

    // Ports
    if (cat === 'trigger' && spec?.objectInput !== 'none') {
      el.append(this.port('in', n.id, 'obj', spec?.objectInput === 'required' ? 'Objects (required)' : 'Objects (optional)'));
    }
    if (cat === 'filter' || cat === 'action') {
      const need = a.needed.get(n.id) ?? 0;
      el.append(this.port('in', n.id, level(need), `Needs: ${describeMask(need)}`));
    }
    if (cat === 'object' && spec?.output !== false) el.append(this.port('out', n.id, 'obj', 'Objects'));
    if (cat === 'trigger' || cat === 'filter') {
      let prov = a.provided.get(n.id) ?? -1;
      if (prov < 0 && cat === 'trigger' && spec?.provides) prov = spec.provides(params, true);
      el.append(this.port('out', n.id, level(prov), `Gives: ${describeMask(a.provided.get(n.id) ?? -1)}`));
    }

    this.bindNode(el, n);
    this.nodeEls.set(n.id, el);
    return el;
  }

  private port(side: 'in' | 'out', id: string, kind: 'obj' | number, title: string): HTMLElement {
    const p = h('div', { class: `port ${side}`, title, dataset: { id, side } });
    p.append(portGlyph(kind, 14));
    if (side === 'out') {
      p.addEventListener('pointerdown', (e) => this.startWire(e, id));
    }
    return p;
  }

  private portCenter(id: string, side: 'in' | 'out'): { x: number; y: number } {
    const n = this.ed.def.graph.nodes.find((x) => x.id === id);
    const el = this.nodeEls.get(id);
    if (!n || !el) return { x: 0, y: 0 };
    const hgt = el.offsetHeight || 70;
    return { x: n.x + (side === 'out' ? NODE_W + 0 : 0), y: n.y + hgt / 2 };
  }

  drawWires(): void {
    const svg = this.svg;
    while (svg.firstChild) svg.firstChild.remove();
    const wires = this.ed.def.graph.wires;
    const errs = this.ed.analysis.wireError;
    wires.forEach((w, k) => {
      const a = this.portCenter(w.from, 'out');
      const b = this.portCenter(w.to, 'in');
      const d = curve(a.x, a.y, b.x, b.y);
      const sel = this.ed.sel?.kind === 'wire' && this.ed.sel.index === k;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `wire${sel ? ' sel' : ''}${errs[k] ? ' bad' : ''}`);
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'hit');
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.ed.select({ kind: 'wire', index: k });
      });
      svg.append(path, hit);
    });
    if (this.temp) svg.append(this.temp);
  }

  flash(id: string): void {
    const el = this.nodeEls.get(id);
    if (!el) return;
    el.classList.add('fired');
    clearTimeout((el as any)._ft);
    (el as any)._ft = setTimeout(() => el.classList.remove('fired'), 160);
  }

  /* ----------------------------- Transform ----------------------------- */

  private applyTransform(): void {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    const s = 22 * this.zoom;
    this.el.style.backgroundSize = `${s}px ${s}px`;
    this.el.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: (clientX - r.left - this.panX) / this.zoom, y: (clientY - r.top - this.panY) / this.zoom };
  }

  /** World point at the center of the visible canvas. */
  center(): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  fit(): void {
    const nodes = this.ed.def.graph.nodes;
    const r = this.el.getBoundingClientRect();
    if (!nodes.length || r.width === 0) { this.panX = 40; this.panY = 40; this.zoom = 1; this.applyTransform(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const hgt = this.nodeEls.get(n.id)?.offsetHeight ?? 80;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + NODE_W); y1 = Math.max(y1, n.y + hgt);
    }
    const pad = 48;
    this.zoom = Math.max(0.3, Math.min(1.2, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
    this.panX = (r.width - (x1 - x0) * this.zoom) / 2 - x0 * this.zoom;
    this.panY = (r.height - (y1 - y0) * this.zoom) / 2 - y0 * this.zoom;
    this.applyTransform();
  }

  /** Pan so a node sits in the top part of the canvas (used on phones, where a sheet covers the bottom). */
  reveal(id: string, frac: number): void {
    const n = this.ed.def.graph.nodes.find((x) => x.id === id);
    if (!n) return;
    const r = this.el.getBoundingClientRect();
    const sy = this.panY + n.y * this.zoom;
    const sx = this.panX + n.x * this.zoom;
    const limit = r.height * frac;
    if (sy > limit || sy < 8) this.panY += limit / 2 - sy;
    if (sx < 8 || sx + NODE_W * this.zoom > r.width - 8) this.panX += (r.width - NODE_W * this.zoom) / 2 - sx;
    this.applyTransform();
  }

  private zoomAt(clientX: number, clientY: number, z: number): void {
    const r = this.el.getBoundingClientRect();
    const nz = Math.max(0.25, Math.min(2.5, z));
    const px = clientX - r.left, py = clientY - r.top;
    this.panX = px - ((px - this.panX) / this.zoom) * nz;
    this.panY = py - ((py - this.panY) / this.zoom) * nz;
    this.zoom = nz;
    this.applyTransform();
  }

  /* ---------------------------- Interaction ---------------------------- */

  private bindCanvas(): void {
    const el = this.el;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this.zoomAt(e.clientX, e.clientY, this.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      else { this.panX -= e.deltaX; this.panY -= e.deltaY; this.applyTransform(); }
    }, { passive: false });

    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.node, .g-tools, .port')) return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [p, q] = [...this.pointers.values()];
        const r = el.getBoundingClientRect();
        this.pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), zoom: this.zoom, cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, px: this.panX, py: this.panY };
        void r;
        return;
      }
      const sx = e.clientX, sy = e.clientY, px = this.panX, py = this.panY;
      let moved = false;
      el.classList.add('panning');
      const move = (ev: PointerEvent) => {
        if (!this.pointers.has(ev.pointerId)) return;
        this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (this.pinch && this.pointers.size >= 2) {
          const [p, q] = [...this.pointers.values()];
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2;
          this.panX = this.pinch.px + (cx - this.pinch.cx);
          this.panY = this.pinch.py + (cy - this.pinch.cy);
          this.zoom = this.pinch.zoom;
          this.zoomAt(cx, cy, this.pinch.zoom * (d / this.pinch.d));
          moved = true;
          return;
        }
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
        this.panX = px + ev.clientX - sx;
        this.panY = py + ev.clientY - sy;
        this.applyTransform();
      };
      const up = (ev: PointerEvent) => {
        this.pointers.delete(ev.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size > 0) return;
        el.classList.remove('panning');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (!moved) this.ed.select(null);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  private bindNode(el: HTMLElement, n: NodeDef): void {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.port')) return;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, nx = n.x, ny = n.y;
      let moved = false;
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / this.zoom, dy = (ev.clientY - sy) / this.zoom;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4 / this.zoom) return;
        moved = true;
        n.x = Math.round((nx + dx) / SNAP) * SNAP;
        n.y = Math.round((ny + dy) / SNAP) * SNAP;
        el.style.left = `${n.x}px`;
        el.style.top = `${n.y}px`;
        this.drawWires();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (moved) this.ed.commitLayout();
        else this.ed.select({ kind: 'node', id: n.id });
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  private startWire(e: PointerEvent, from: string): void {
    e.stopPropagation();
    e.preventDefault();
    const portEl = e.currentTarget as HTMLElement;
    portEl.setPointerCapture(e.pointerId);
    const g = this.ed.def.graph;
    const reg = this.ed.reg;
    // Mark which inputs accept this wire.
    const ok = new Set<string>();
    for (const n of g.nodes) if (canConnect(g, reg, from, n.id)) ok.add(n.id);
    this.world.querySelectorAll<HTMLElement>('.port.in').forEach((p) => p.classList.add(ok.has(p.dataset.id!) ? 'ok' : 'no'));
    const a = this.portCenter(from, 'out');
    this.temp = document.createElementNS(NS, 'path');
    this.temp.setAttribute('class', 'wire temp');
    this.svg.append(this.temp);
    const target = (ev: PointerEvent): string | null => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const node = hit?.closest<HTMLElement>('.node');
      const id = node?.dataset.id ?? null;
      return id && ok.has(id) ? id : null;
    };
    const move = (ev: PointerEvent) => {
      const t = target(ev);
      const b = t ? this.portCenter(t, 'in') : this.toWorld(ev.clientX, ev.clientY);
      this.temp!.setAttribute('d', curve(a.x, a.y, b.x, b.y));
    };
    const up = (ev: PointerEvent) => {
      portEl.removeEventListener('pointermove', move);
      portEl.removeEventListener('pointerup', up);
      portEl.removeEventListener('pointercancel', up);
      this.world.querySelectorAll('.port.in').forEach((p) => p.classList.remove('ok', 'no'));
      this.temp?.remove();
      this.temp = null;
      const t = ev.type === 'pointerup' ? target(ev) : null;
      if (t) this.ed.addWire(from, t);
      else this.drawWires();
    };
    portEl.addEventListener('pointermove', move);
    portEl.addEventListener('pointerup', up);
    portEl.addEventListener('pointercancel', up);
  }
}

function curve(x0: number, y0: number, x1: number, y1: number): string {
  const dx = Math.max(40, Math.abs(x1 - x0) * 0.5);
  return `M${x0},${y0} C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`;
}
