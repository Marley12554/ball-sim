import { analyzeGraph, canConnect, withDefaults } from '@engine/index';
import type { GraphAnalysis, NodeDef } from '@engine/index';
import { registry } from '../../sim/blocks';
import type { SimBlock } from '../../sim/blocks';
import type { SimDef, SimSettings } from '../../sim/types';
import { h, icon, iconButton, menu, toast, downloadFile } from '../dom';
import { Player, onTick } from '../player';
import { saveSim, deleteSim, newId, encodeShare, shareUrl, copyText } from '../store';
import { navigate } from '../router';
import { GraphView } from './graph';
import { renderInspector } from './inspector';
import { CAT_COLOR, level, portGlyph } from './ports';

export type Selection = { kind: 'node'; id: string } | { kind: 'wire'; index: number } | null;

export interface EditorOptions {
  def: SimDef;
  /** Saved id, or null for an unsaved copy (preset / new). */
  id: string | null;
  /** Where "Play" goes when there's no saved id yet. */
  playHref: string;
}

export class Editor {
  def: SimDef;
  readonly reg = registry;
  analysis: GraphAnalysis;
  sel: Selection = null;
  id: string | null;
  graph: GraphView;
  private inspectorEl: HTMLElement;
  private sideEl: HTMLElement;
  private paletteEl: HTMLElement;
  private player: Player;
  private history: string[] = [];
  private future: string[] = [];
  private lastPush = 0;
  private saveTimer = 0;
  private previewTimer = 0;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private savedEl: HTMLElement;
  private nameInput: HTMLInputElement;
  private previewStat: HTMLElement;
  private playPreviewBtn: HTMLButtonElement;
  readonly root: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(private opts: EditorOptions) {
    this.def = structuredClone(opts.def);
    this.id = opts.id;
    this.analysis = analyzeGraph(this.def.graph, this.reg);
    this.graph = new GraphView(this);

    // Top bar
    this.nameInput = h('input', { class: 'e-name', value: this.def.name, spellcheck: false, 'aria-label': 'Name' });
    this.nameInput.addEventListener('input', () => this.change(() => { this.def.name = this.nameInput.value || 'Untitled'; }, { graph: 'none', restart: false, merge: true }));
    this.undoBtn = iconButton('undo', 'Undo', () => this.undo());
    this.redoBtn = iconButton('redo', 'Redo', () => this.redo());
    this.savedEl = h('span', { class: 'e-saved' }, this.id ? 'Saved' : '');
    const moreBtn: HTMLButtonElement = iconButton('more', 'More', () => menu(moreBtn, [
      { label: 'Settings', icon: 'sliders', onClick: () => { this.select(null); this.openSide(); } },
      { label: 'Copy link', icon: 'link', onClick: () => this.share() },
      { label: 'Export file', icon: 'download', onClick: () => downloadFile(`${slug(this.def.name)}.json`, new Blob([JSON.stringify(this.def, null, 1)], { type: 'application/json' })) },
      ...(this.id ? [{ label: 'Delete simulation', icon: 'trash', danger: true, onClick: () => { if (confirm('Delete this simulation?')) { deleteSim(this.id!); navigate('#/'); } } }] : []),
    ]));
    const top = h('div', { class: 'e-top' },
      iconButton('back', 'Back to gallery', () => navigate('#/')),
      this.nameInput,
      h('div', { class: 'spacer' }),
      this.savedEl,
      this.undoBtn, this.redoBtn,
      iconButton('expand', 'Preview', () => this.togglePreviewSheet(), 'phone-only'),
      h('button', { class: 'btn primary', onclick: () => this.play() }, icon('play', 14), h('span', { class: 'hide-phone' }, 'Play')),
      moreBtn);
    top.querySelector('.phone-only')?.classList.add('preview-toggle');

    // Palette
    this.paletteEl = h('div', { class: 'palette' }, iconButton('close', 'Close', () => this.paletteEl.classList.remove('open'), 'sheet-close'), ...this.paletteGroups());

    // Side: preview + inspector
    const canvas = h('canvas');
    this.player = new Player(canvas, this.def, { hud: true, budgetMs: 6, dprCap: 2 });
    this.player.onFire = (id) => this.graph.flash(id);
    this.player.load(this.def);
    this.previewStat = h('span', { class: 'preview-stat' });
    this.playPreviewBtn = iconButton('pause', 'Pause', () => {
      this.player.setPaused(!this.player.paused);
      this.playPreviewBtn.replaceChildren(icon(this.player.paused ? 'play' : 'pause'));
    });
    this.inspectorEl = h('div', { class: 'inspector' });
    this.sideEl = h('div', { class: 'side' },
      h('div', { class: 'preview' }, canvas,
        h('div', { class: 'preview-bar' }, this.playPreviewBtn, iconButton('restart', 'Restart', () => this.player.restart()),
          h('div', { class: 'spacer' }), this.previewStat,
          iconButton('close', 'Close', () => this.togglePreviewSheet(false), 'sheet-close'))),
      this.inspectorEl);

    const fab = iconButton('plus', 'Add block', () => this.paletteEl.classList.add('open'), 'fab');
    this.root = h('div', { class: 'editor' }, top, this.paletteEl, this.graph.el, this.sideEl);
    this.graph.el.append(fab);

    this.renderInspector();
    this.updateUndo();

    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.cleanup.push(() => window.removeEventListener('keydown', onKey));
    let statT = 0;
    this.cleanup.push(onTick((dt) => {
      this.player.frame(dt);
      statT += dt;
      if (statT > 0.3) {
        statT = 0;
        const s = this.player.sim;
        this.previewStat.textContent = s.outcome ? s.outcome.label : `${s.world.aliveCount} balls`;
      }
    }));
  }

  mount(container: HTMLElement): void {
    container.replaceChildren(this.root);
    this.graph.render();
    requestAnimationFrame(() => this.graph.fit());
  }

  destroy(): void {
    this.flushSave();
    for (const f of this.cleanup) f();
  }

  /* ------------------------------ Palette ------------------------------ */

  private paletteGroups(): HTMLElement[] {
    const cats: [SimBlock['category'], string][] = [['object', 'Objects'], ['trigger', 'Triggers'], ['filter', 'Filters'], ['action', 'Actions']];
    return cats.map(([cat, label]) => h('div', { class: 'pal-group' },
      h('div', { class: 'pal-label' }, h('i', { style: { background: CAT_COLOR[cat] } }), label),
      ...this.reg.byCategory(cat).map((b) => this.paletteItem(b))));
  }

  private paletteItem(b: SimBlock): HTMLElement {
    let glyph: SVGSVGElement | null = null;
    const p = withDefaults(b, {});
    if (b.category === 'trigger') glyph = portGlyph(level(b.provides ? b.provides(p, true) : 0), 12);
    else if (b.category === 'action' || b.category === 'filter') glyph = portGlyph(level(b.needs ? b.needs(p) : needsDefault(b, p)), 12);
    if (glyph) { glyph.classList.add('port-glyph'); glyph.style.setProperty('--cat', CAT_COLOR[b.category]); }
    const item = h('button', { class: 'pal-item', title: b.label }, b.label, glyph);
    // Tap adds at the center. Drag drops where released.
    item.addEventListener('pointerdown', (e) => {
      const sx = e.clientX, sy = e.clientY;
      let ghost: HTMLElement | null = null;
      item.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
          ghost = h('div', { class: 'node', style: { position: 'fixed', pointerEvents: 'none', opacity: '0.85', zIndex: '80', '--cat': CAT_COLOR[b.category] } as any },
            h('div', { class: 'node-head' }, h('span', { class: 'node-cat' }, b.category)), h('div', { class: 'node-title' }, b.label), h('div', { class: 'node-sum' }, ' '));
          ghost.style.setProperty('--cat', CAT_COLOR[b.category]);
          document.body.append(ghost);
          this.paletteEl.classList.remove('open');
        }
        if (ghost) { ghost.style.left = `${ev.clientX - 30}px`; ghost.style.top = `${ev.clientY - 20}px`; }
      };
      const up = (ev: PointerEvent) => {
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', up);
        item.removeEventListener('pointercancel', up);
        if (ghost) {
          ghost.remove();
          const r = this.graph.el.getBoundingClientRect();
          if (ev.type === 'pointerup' && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) {
            const w = this.graph.toWorld(ev.clientX - 30, ev.clientY - 20);
            this.addNode(b.type, w.x, w.y);
          }
        } else if (ev.type === 'pointerup') {
          this.paletteEl.classList.remove('open');
          this.addNode(b.type);
        }
      };
      item.addEventListener('pointermove', move);
      item.addEventListener('pointerup', up);
      item.addEventListener('pointercancel', up);
    });
    return item;
  }

  /* ------------------------------ Changes ------------------------------ */

  /**
   * Apply a change. Records undo history, re-analyzes the graph, re-renders
   * what's asked, restarts the preview and autosaves.
   */
  change(fn: () => void, o: { graph?: 'full' | 'none'; restart?: boolean; inspector?: boolean; merge?: boolean } = {}): void {
    const now = Date.now();
    if (!(o.merge && now - this.lastPush < 900)) {
      this.history.push(JSON.stringify(this.def));
      if (this.history.length > 100) this.history.shift();
      this.future = [];
    }
    this.lastPush = now;
    fn();
    this.analysis = analyzeGraph(this.def.graph, this.reg);
    if (o.graph !== 'none') this.graph.render();
    if (o.inspector) this.renderInspector();
    if (o.restart !== false) this.schedulePreview();
    this.scheduleSave();
    this.updateUndo();
  }

  /** End a run of merged edits (typing, scrubbing) so the next edit starts a new undo step. */
  commit(): void {
    this.lastPush = 0;
  }

  commitLayout(): void {
    this.history.push(JSON.stringify(this.def));
    this.future = [];
    this.graph.drawWires();
    this.scheduleSave();
    this.updateUndo();
  }

  private restore(json: string): void {
    this.def = JSON.parse(json);
    this.nameInput.value = this.def.name;
    if (this.sel?.kind === 'node' && !this.def.graph.nodes.some((n) => n.id === (this.sel as any).id)) this.sel = null;
    if (this.sel?.kind === 'wire' && !this.def.graph.wires[this.sel.index]) this.sel = null;
    this.analysis = analyzeGraph(this.def.graph, this.reg);
    this.graph.render();
    this.renderInspector();
    this.schedulePreview();
    this.scheduleSave();
    this.updateUndo();
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(JSON.stringify(this.def));
    this.restore(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(JSON.stringify(this.def));
    this.restore(next);
  }

  private updateUndo(): void {
    this.undoBtn.disabled = this.history.length === 0;
    this.redoBtn.disabled = this.future.length === 0;
  }

  private schedulePreview(): void {
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.player.load(structuredClone(this.def)), 250);
  }

  private scheduleSave(): void {
    if (!this.id) {
      this.id = newId();
      history.replaceState(null, '', `#/edit/${this.id}`);
    }
    this.savedEl.textContent = '';
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 500);
  }

  private flushSave(): void {
    clearTimeout(this.saveTimer);
    if (!this.id) return;
    if (saveSim(this.id, this.def)) this.savedEl.textContent = 'Saved';
    else this.savedEl.textContent = 'Not saved';
  }

  /* ------------------------------ Selection ------------------------------ */

  select(sel: Selection): void {
    this.sel = sel;
    this.graph.render();
    this.renderInspector();
    if (sel) this.openSide();
    else this.sideEl.classList.remove('open');
    if (sel?.kind === 'node' && window.matchMedia('(max-width: 900px)').matches) this.graph.reveal(sel.id, 0.3);
  }

  private openSide(): void {
    this.sideEl.classList.remove('preview-mode');
    this.sideEl.classList.add('open');
  }

  private togglePreviewSheet(force?: boolean): void {
    const on = force ?? !(this.sideEl.classList.contains('open') && this.sideEl.classList.contains('preview-mode'));
    this.sideEl.classList.toggle('preview-mode', on);
    this.sideEl.classList.toggle('open', on);
  }

  renderInspector(): void {
    renderInspector(this, this.inspectorEl);
  }

  /* ------------------------------ Graph ops ------------------------------ */

  addNode(type: string, x?: number, y?: number): void {
    const spec = this.reg.get(type);
    if (!spec) return;
    const params = withDefaults(spec, {});
    if (spec.category === 'object' && 'name' in params) params.name = this.uniqueName(params.name);
    const id = this.newNodeId();
    const prevSel = this.sel;
    const anchor = prevSel?.kind === 'node' ? this.def.graph.nodes.find((n) => n.id === prevSel.id) : undefined;
    const willWire = !!anchor && canConnect({ nodes: [...this.def.graph.nodes, { id, type, x: 0, y: 0, params }], wires: this.def.graph.wires }, this.reg, anchor.id, id);
    if (x === undefined || y === undefined) {
      if (willWire && anchor) {
        x = anchor.x + 280;
        y = anchor.y;
      } else {
        const c = this.graph.center();
        x = c.x - 98;
        y = c.y - 35;
      }
      while (this.def.graph.nodes.some((n) => Math.abs(n.x - x!) < 150 && Math.abs(n.y - y!) < 70)) y! += 90;
    }
    const node: NodeDef = { id, type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, params };
    this.change(() => {
      this.def.graph.nodes.push(node);
      // Convenience: wire from the selected block when it fits.
      if (prevSel?.kind === 'node' && canConnect(this.def.graph, this.reg, prevSel.id, id)) {
        this.def.graph.wires.push({ from: prevSel.id, to: id });
      }
    });
    this.select({ kind: 'node', id });
  }

  duplicateNode(id: string): void {
    const n = this.def.graph.nodes.find((x) => x.id === id);
    if (!n) return;
    const copy: NodeDef = { ...structuredClone(n), id: this.newNodeId(), x: n.x + 30, y: n.y + 30 };
    const spec = this.reg.get(n.type);
    if (spec?.category === 'object' && copy.params.name) copy.params.name = this.uniqueName(copy.params.name);
    this.change(() => this.def.graph.nodes.push(copy));
    this.select({ kind: 'node', id: copy.id });
  }

  removeNode(id: string): void {
    this.change(() => {
      const g = this.def.graph;
      g.nodes = g.nodes.filter((n) => n.id !== id);
      g.wires = g.wires.filter((w) => w.from !== id && w.to !== id);
      // Clear references to the removed object.
      for (const n of g.nodes) for (const [k, v] of Object.entries(n.params)) if (v === id) n.params[k] = '';
    });
    this.select(null);
  }

  addWire(from: string, to: string): void {
    if (!canConnect(this.def.graph, this.reg, from, to)) return;
    this.change(() => this.def.graph.wires.push({ from, to }));
    this.renderInspector();
  }

  removeWire(index: number): void {
    this.change(() => this.def.graph.wires.splice(index, 1));
    this.select(null);
  }

  setParam(id: string, key: string, value: any, rerenderInspector: boolean): void {
    const n = this.def.graph.nodes.find((x) => x.id === id);
    if (!n) return;
    this.change(() => { n.params = { ...n.params, [key]: value }; }, { merge: !rerenderInspector, inspector: rerenderInspector });
  }

  setSetting<K extends keyof SimSettings>(k: K, v: SimSettings[K], rerender: boolean): void {
    this.change(() => { this.def.settings = { ...this.def.settings, [k]: v }; }, { graph: 'none', merge: !rerender, inspector: rerender });
  }

  setSeed(seed: number, rerender: boolean): void {
    this.change(() => { this.def.seed = seed >>> 0; }, { graph: 'none', merge: !rerender, inspector: rerender });
  }

  addAsset(dataUrl: string): string {
    const id = `img${Date.now().toString(36)}`;
    this.change(() => { this.def.assets = { ...(this.def.assets ?? {}), [id]: dataUrl }; }, { graph: 'none', inspector: this.sel === null });
    return id;
  }

  removeAsset(id: string): void {
    this.change(() => {
      const a = { ...(this.def.assets ?? {}) };
      delete a[id];
      this.def.assets = a;
    }, { graph: 'none', inspector: true });
  }

  /* ------------------------------ Queries ------------------------------ */

  nameOf(id: string): string {
    const n = this.def.graph.nodes.find((x) => x.id === id);
    if (!n) return '?';
    const spec = this.reg.get(n.type);
    return (n.params.name as string) || spec?.label || n.type;
  }

  labelOf(id: string): string {
    const n = this.def.graph.nodes.find((x) => x.id === id);
    if (!n) return '?';
    const spec = this.reg.get(n.type);
    return spec?.category === 'object' ? this.nameOf(id) : spec?.label ?? n.type;
  }

  /** Context available to a node from its inputs, or null if nothing is wired in. */
  upstreamMask(id: string): number | null {
    let m: number | null = null;
    this.def.graph.wires.forEach((w, k) => {
      if (w.to !== id || this.analysis.wireError[k]) return;
      const p = this.analysis.provided.get(w.from);
      if (p === undefined || p < 0) return;
      m = m === null ? p : m & p;
    });
    return m;
  }

  nodeWarning(n: NodeDef): string {
    const spec = this.reg.get(n.type);
    if (!spec) return 'Unknown block';
    if (spec.category === 'trigger' && spec.objectInput === 'required' && (this.analysis.provided.get(n.id) ?? -1) < 0) return 'Wire objects in';
    const p = withDefaults(spec, n.params);
    for (const ps of spec.params) {
      if (ps.type !== 'ref' || ps.anyLabel !== undefined) continue;
      if (ps.showIf && !ps.showIf(p)) continue;
      const v = p[ps.key];
      if (!v || !this.def.graph.nodes.some((x) => x.id === v)) return `Choose ${ps.label.toLowerCase()}`;
    }
    return '';
  }

  private uniqueName(base: string): string {
    const names = new Set(this.def.graph.nodes.map((n) => n.params.name));
    if (!names.has(base)) return base;
    for (let k = 2; ; k++) if (!names.has(`${base} ${k}`)) return `${base} ${k}`;
  }

  private newNodeId(): string {
    const ids = new Set(this.def.graph.nodes.map((n) => n.id));
    for (let k = this.def.graph.nodes.length + 1; ; k++) if (!ids.has(`n${k}`)) return `n${k}`;
  }

  /* ------------------------------ Actions ------------------------------ */

  private play(): void {
    this.flushSave();
    if (this.id) navigate(`#/m/${this.id}`);
    else navigate(this.opts.playHref);
  }

  private async share(): Promise<void> {
    const url = shareUrl(await encodeShare(this.def));
    if (await copyText(url)) toast('Link copied');
    else prompt('Copy this link', url);
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); this.redo(); return; }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) {
      e.preventDefault();
      if (this.sel.kind === 'node') this.removeNode(this.sel.id);
      else this.removeWire(this.sel.index);
    } else if (mod && e.key.toLowerCase() === 'd' && this.sel?.kind === 'node') {
      e.preventDefault();
      this.duplicateNode(this.sel.id);
    } else if (e.key === 'Escape') this.select(null);
  }
}

function needsDefault(b: SimBlock, p: Record<string, any>): number {
  let m = 0;
  for (const ps of b.params) {
    if (ps.type !== 'enum' || !ps.options) continue;
    const o = ps.options.find((x) => x.value === p[ps.key]);
    if (o?.needs) m |= o.needs;
  }
  return m;
}

function slug(s: string): string {
  return s.replace(/[^\w-]+/g, '-').toLowerCase() || 'simulation';
}

export function mountEditor(root: HTMLElement, opts: EditorOptions): () => void {
  const ed = new Editor(opts);
  ed.mount(root);
  return () => ed.destroy();
}
