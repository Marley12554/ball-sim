/**
 * Hand-drawn (in code) art: titanium parts, weapons, powerups, flames, horns.
 * Everything is drawn with layered gradients and highlights, in a local frame
 * where +x points along the object.
 */

type G = CanvasRenderingContext2D;

export function titaniumFill(g: G, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  // Brushed metal: bands across the short axis.
  const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const gr = horizontal ? g.createLinearGradient(0, y0, 0, y1) : g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, '#59616C');
  gr.addColorStop(0.18, '#BFC7D0');
  gr.addColorStop(0.42, '#F2F5F8');
  gr.addColorStop(0.58, '#AEB7C1');
  gr.addColorStop(0.82, '#7E8894');
  gr.addColorStop(1, '#4A515B');
  return gr;
}

export function titaniumBlock(g: G, x0: number, y0: number, x1: number, y1: number, rivets = true): void {
  const w = x1 - x0, h = y1 - y0;
  const r = Math.min(w, h) * 0.16;
  g.save();
  g.beginPath();
  rr(g, x0, y0, w, h, r);
  g.fillStyle = titaniumFill(g, x0, y0, x1, y1);
  g.fill();
  // Bevel
  g.lineWidth = Math.max(1, Math.min(w, h) * 0.06);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  rr(g, x0 + g.lineWidth, y0 + g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2, r * 0.7);
  g.stroke();
  g.lineWidth = Math.max(1, Math.min(w, h) * 0.04);
  g.strokeStyle = 'rgba(20,24,30,0.65)';
  g.beginPath();
  rr(g, x0, y0, w, h, r);
  g.stroke();
  if (rivets) {
    const rv = Math.min(w, h) * 0.07;
    const pts = [[x0 + rv * 2.4, y0 + rv * 2.4], [x1 - rv * 2.4, y0 + rv * 2.4], [x0 + rv * 2.4, y1 - rv * 2.4], [x1 - rv * 2.4, y1 - rv * 2.4]];
    for (const [px, py] of pts) {
      const rg = g.createRadialGradient(px - rv * 0.3, py - rv * 0.3, 0, px, py, rv);
      rg.addColorStop(0, '#FFFFFF');
      rg.addColorStop(1, '#6B7480');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(px, py, rv, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

export function steelRod(g: G, x0: number, x1: number, half: number): void {
  const gr = g.createLinearGradient(0, -half, 0, half);
  gr.addColorStop(0, '#2B3038');
  gr.addColorStop(0.35, '#8A939E');
  gr.addColorStop(0.5, '#D5DBE1');
  gr.addColorStop(0.7, '#5D6670');
  gr.addColorStop(1, '#22262C');
  g.fillStyle = gr;
  g.beginPath();
  rr(g, x0, -half, x1 - x0, half * 2, half * 0.6);
  g.fill();
}

export function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* --------------------------------- Weapons ---------------------------------- */

/** Draw a weapon from x0 to x1 along +x (local frame), unit = holder radius. */
export function drawWeapon(g: G, type: string, x0: number, x1: number, u: number, t: number, power: number): void {
  const L = x1 - x0;
  switch (type) {
    case 'sword': {
      const grip = L * 0.22;
      // Grip
      const leather = g.createLinearGradient(0, -u * 0.12, 0, u * 0.12);
      leather.addColorStop(0, '#3B2A20'); leather.addColorStop(0.5, '#7A5638'); leather.addColorStop(1, '#2A1D15');
      g.fillStyle = leather;
      g.beginPath(); rr(g, x0, -u * 0.11, grip, u * 0.22, u * 0.05); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = u * 0.03;
      for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(x0 + (grip * k) / 5, -u * 0.11); g.lineTo(x0 + (grip * k) / 5 + u * 0.06, u * 0.11); g.stroke(); }
      // Pommel
      gold(g, x0, 0, u * 0.13);
      // Crossguard
      const gx = x0 + grip;
      const gg = g.createLinearGradient(gx - u * 0.08, 0, gx + u * 0.08, 0);
      gg.addColorStop(0, '#8A6A1E'); gg.addColorStop(0.5, '#FDE68A'); gg.addColorStop(1, '#A57C1B');
      g.fillStyle = gg;
      g.beginPath(); rr(g, gx - u * 0.07, -u * 0.42, u * 0.14, u * 0.84, u * 0.06); g.fill();
      // Blade
      const bx = gx + u * 0.07, tip = x1;
      const blade = g.createLinearGradient(0, -u * 0.17, 0, u * 0.17);
      blade.addColorStop(0, '#8C96A3'); blade.addColorStop(0.45, '#F8FAFC'); blade.addColorStop(0.55, '#C3CBD5'); blade.addColorStop(1, '#6B7582');
      g.fillStyle = blade;
      g.beginPath();
      g.moveTo(bx, -u * 0.15); g.lineTo(tip - u * 0.4, -u * 0.13); g.lineTo(tip, 0); g.lineTo(tip - u * 0.4, u * 0.13); g.lineTo(bx, u * 0.15);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(80,90,105,0.8)'; g.lineWidth = u * 0.03;
      g.beginPath(); g.moveTo(bx + u * 0.1, 0); g.lineTo(tip - u * 0.5, 0); g.stroke();
      glint(g, tip - u * 0.35, -u * 0.06, u * 0.12, power);
      break;
    }
    case 'spear': {
      const shaft = g.createLinearGradient(0, -u * 0.09, 0, u * 0.09);
      shaft.addColorStop(0, '#5B3A1E'); shaft.addColorStop(0.5, '#B07A44'); shaft.addColorStop(1, '#4A2F18');
      g.fillStyle = shaft;
      g.beginPath(); rr(g, x0, -u * 0.08, L - u * 0.6, u * 0.16, u * 0.06); g.fill();
      // Bindings
      g.fillStyle = '#1F2937';
      for (const f of [0.25, 0.6]) { g.beginPath(); rr(g, x0 + (L - u * 0.6) * f, -u * 0.1, u * 0.12, u * 0.2, u * 0.03); g.fill(); }
      // Leaf tip
      const hx = x1 - u * 0.75;
      const tipG = g.createLinearGradient(0, -u * 0.2, 0, u * 0.2);
      tipG.addColorStop(0, '#7C8794'); tipG.addColorStop(0.5, '#F1F5F9'); tipG.addColorStop(1, '#5F6A77');
      g.fillStyle = tipG;
      g.beginPath();
      g.moveTo(hx, 0); g.quadraticCurveTo(hx + u * 0.3, -u * 0.26, x1, 0); g.quadraticCurveTo(hx + u * 0.3, u * 0.26, hx, 0);
      g.fill();
      glint(g, x1 - u * 0.25, -u * 0.05, u * 0.1, power);
      break;
    }
    case 'hammer': {
      const handle = g.createLinearGradient(0, -u * 0.1, 0, u * 0.1);
      handle.addColorStop(0, '#4B2E17'); handle.addColorStop(0.5, '#9C6B3A'); handle.addColorStop(1, '#3A2412');
      g.fillStyle = handle;
      g.beginPath(); rr(g, x0, -u * 0.09, L - u * 0.5, u * 0.18, u * 0.06); g.fill();
      titaniumBlock(g, x1 - u * 0.75, -u * 0.55, x1, u * 0.55, false);
      g.fillStyle = 'rgba(255,90,31,' + Math.min(0.6, power * 0.08) + ')';
      g.beginPath(); rr(g, x1 - u * 0.75, -u * 0.55, u * 0.75, u * 1.1, u * 0.12); g.fill();
      break;
    }
    case 'match': {
      const stick = g.createLinearGradient(0, -u * 0.08, 0, u * 0.08);
      stick.addColorStop(0, '#C9A06A'); stick.addColorStop(0.5, '#F3D9A4'); stick.addColorStop(1, '#B08752');
      g.fillStyle = stick;
      g.beginPath(); rr(g, x0, -u * 0.07, L - u * 0.3, u * 0.14, u * 0.04); g.fill();
      const hx = x1 - u * 0.32;
      const head = g.createRadialGradient(hx - u * 0.06, -u * 0.06, 0, hx, 0, u * 0.24);
      head.addColorStop(0, '#F87171'); head.addColorStop(1, '#7F1D1D');
      g.fillStyle = head;
      g.beginPath(); g.ellipse(hx, 0, u * 0.28, u * 0.2, 0, 0, Math.PI * 2); g.fill();
      flame(g, hx + u * 0.15, 0, u * (0.5 + Math.min(0.5, power * 0.05)), t);
      break;
    }
    case 'rod': {
      const rod = g.createLinearGradient(0, -u * 0.08, 0, u * 0.08);
      rod.addColorStop(0, '#7C2D12'); rod.addColorStop(0.5, '#FDBA74'); rod.addColorStop(1, '#9A3412');
      g.fillStyle = rod;
      g.beginPath(); rr(g, x0, -u * 0.07, L - u * 0.25, u * 0.14, u * 0.05); g.fill();
      for (let k = 0; k < 3; k++) { g.fillStyle = '#E2E8F0'; g.beginPath(); rr(g, x0 + L * (0.2 + k * 0.18), -u * 0.11, u * 0.08, u * 0.22, u * 0.03); g.fill(); }
      const ox = x1 - u * 0.12;
      const orb = g.createRadialGradient(ox - u * 0.05, -u * 0.05, 0, ox, 0, u * 0.24);
      orb.addColorStop(0, '#FFFFFF'); orb.addColorStop(0.4, '#A5F3FC'); orb.addColorStop(1, 'rgba(34,211,238,0.2)');
      g.fillStyle = orb;
      g.beginPath(); g.arc(ox, 0, u * 0.22, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(165,243,252,0.85)'; g.lineWidth = u * 0.03;
      for (let k = 0; k < 3; k++) {
        const a = t * 9 + k * 2.1;
        g.beginPath();
        g.moveTo(ox, 0);
        g.lineTo(ox + Math.cos(a) * u * 0.25, Math.sin(a) * u * 0.25);
        g.lineTo(ox + Math.cos(a + 0.4) * u * 0.38, Math.sin(a + 0.4) * u * 0.38);
        g.stroke();
      }
      break;
    }
    case 'shield': {
      // A round shield facing outward along +x, centered near x1.
      const cx = (x0 + x1) / 2 + u * 0.15, rad = u * 0.62;
      const wood = g.createLinearGradient(cx - rad, 0, cx + rad, 0);
      wood.addColorStop(0, '#5B3A1E'); wood.addColorStop(0.5, '#A16B3A'); wood.addColorStop(1, '#5B3A1E');
      g.save();
      g.translate(cx, 0);
      g.scale(0.45, 1);
      g.fillStyle = wood;
      g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fill();
      g.lineWidth = u * 0.14;
      g.strokeStyle = titaniumFill(g, -rad, -rad, rad, rad);
      g.stroke();
      const boss = g.createRadialGradient(-rad * 0.15, -rad * 0.15, 0, 0, 0, rad * 0.35);
      boss.addColorStop(0, '#FFFFFF'); boss.addColorStop(1, '#6B7480');
      g.fillStyle = boss;
      g.beginPath(); g.arc(0, 0, rad * 0.3, 0, Math.PI * 2); g.fill();
      g.restore();
      break;
    }
  }
}

function gold(g: G, x: number, y: number, r: number): void {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  gr.addColorStop(0, '#FEF3C7'); gr.addColorStop(1, '#A16207');
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

function glint(g: G, x: number, y: number, r: number, power: number): void {
  const a = Math.min(0.9, 0.3 + power * 0.06);
  const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r * 1.6, 0, Math.PI * 2); g.fill();
}

/** Flickering flame centered at (x, y), size s, pointing up the local -y... drawn in screen up. */
export function flame(g: G, x: number, y: number, s: number, t: number): void {
  const f = 0.85 + 0.15 * Math.sin(t * 23 + x) + 0.1 * Math.sin(t * 37);
  const outer = g.createRadialGradient(x, y, 0, x, y, s * f);
  outer.addColorStop(0, 'rgba(255,247,200,0.95)');
  outer.addColorStop(0.35, 'rgba(253,186,116,0.8)');
  outer.addColorStop(0.7, 'rgba(234,88,12,0.35)');
  outer.addColorStop(1, 'rgba(234,88,12,0)');
  g.fillStyle = outer;
  g.beginPath(); g.arc(x, y, s * f, 0, Math.PI * 2); g.fill();
}

/* --------------------------------- Powerups --------------------------------- */

export function drawPowerup(g: G, x: number, y: number, s: number, color: string, kind: string, t: number): void {
  const bob = Math.sin(t * 3 + x * 0.1) * s * 0.12;
  g.save();
  g.translate(x, y + bob);
  g.rotate(Math.sin(t * 1.3 + y) * 0.25);
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, s * 2.6);
  halo.addColorStop(0, color + '66');
  halo.addColorStop(1, color + '00');
  g.fillStyle = halo;
  g.beginPath(); g.arc(0, 0, s * 2.6, 0, Math.PI * 2); g.fill();
  const body = g.createLinearGradient(-s, -s, s, s);
  body.addColorStop(0, '#FFFFFF');
  body.addColorStop(0.35, color);
  body.addColorStop(1, shade(color, -0.35));
  g.fillStyle = body;
  g.beginPath(); rr(g, -s, -s, s * 2, s * 2, s * 0.35); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = Math.max(1, s * 0.14);
  g.lineCap = 'round';
  g.beginPath();
  if (kind === 'green') { g.moveTo(-s * 0.45, 0); g.lineTo(s * 0.45, 0); g.moveTo(0, -s * 0.45); g.lineTo(0, s * 0.45); }
  else if (kind === 'red') { g.moveTo(-s * 0.4, s * 0.4); g.lineTo(s * 0.4, -s * 0.4); g.moveTo(s * 0.05, -s * 0.4); g.lineTo(s * 0.4, -s * 0.4); g.lineTo(s * 0.4, -s * 0.05); }
  else if (kind === 'cyan') { g.moveTo(0, -s * 0.5); g.lineTo(s * 0.42, -s * 0.28); g.lineTo(s * 0.32, s * 0.2); g.lineTo(0, s * 0.5); g.lineTo(-s * 0.32, s * 0.2); g.lineTo(-s * 0.42, -s * 0.28); g.closePath(); }
  else { g.arc(0, 0, s * 0.42, 0.3, Math.PI * 1.7); }
  g.stroke();
  g.restore();
}

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  const r = f((n >> 16) & 255), gg = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Imp horns, drawn around a ball of radius r centered at (x, y). */
export function horns(g: G, x: number, y: number, r: number): void {
  for (const sx of [-1, 1]) {
    const gr = g.createLinearGradient(x + sx * r * 0.5, y - r * 0.6, x + sx * r * 0.9, y - r * 1.35);
    gr.addColorStop(0, '#7E22CE');
    gr.addColorStop(1, '#F5D0FE');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x + sx * r * 0.35, y - r * 0.82);
    g.quadraticCurveTo(x + sx * r * 0.95, y - r * 0.95, x + sx * r * 1.0, y - r * 1.45);
    g.quadraticCurveTo(x + sx * r * 0.7, y - r * 1.0, x + sx * r * 0.75, y - r * 0.55);
    g.closePath();
    g.fill();
  }
}
