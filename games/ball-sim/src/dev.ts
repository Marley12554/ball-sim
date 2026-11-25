// Dev scene for eyeballing the physics core. Hand-wired, replaced by the rule system in step 2.
import { World, Runner, Rng, ring, dmath, CONTACT_WALL } from '@engine/index';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const seed = Number(new URLSearchParams(location.search).get('seed') ?? 7);
const rng = new Rng(seed);

const world = new World({ capacity: 4000, gravityY: 0 });
const ringCount = 6;
const rings: number[] = [];
for (let k = 0; k < ringCount; k++) {
  const R = 60 + k * 32;
  const id = world.addCollider({
    pieces: ring(R, 2, [{ at: rng.range(0, dmath.TAU), width: 0.55 }]),
    angularVelocity: (k % 2 ? -1 : 1) * (0.6 + k * 0.15),
  });
  rings.push(id);
}
const hues = [18, 200, 140, 280];
const balls: { h: number; hue: number }[] = [];
for (let k = 0; k < 4; k++) {
  const a = rng.range(0, dmath.TAU);
  const h = world.createBody({ x: dmath.cos(a) * 20, y: dmath.sin(a) * 20, vx: rng.range(-260, 260), vy: rng.range(-260, 260), radius: 6 });
  balls.push({ h, hue: hues[k] });
}

const runner = new Runner(() => {
  world.step();
  for (let k = 0; k < world.contactCount; k++) {
    if (world.cKind[k] !== CONTACT_WALL) continue;
    const body = world.handleAt(world.cA[k]);
    world.addTether({ body, anchor: { kind: 'collider', collider: world.cB[k], x: world.cPx[k], y: world.cPy[k] }, stiffness: 0 });
  }
}, { dt: world.cfg.dt });

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}
addEventListener('resize', resize);
resize();

const p = { x: 0, y: 0 };
let last = performance.now();
function frame(now: number) {
  runner.frame((now - last) / 1000);
  last = now;
  const W = canvas.width, H = canvas.height;
  const scale = Math.min(W, H) / (2 * (60 + ringCount * 32 + 20));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0A0B0D';
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(scale, 0, 0, scale, W / 2, H / 2);

  // Rings
  ctx.lineCap = 'round';
  for (let p0 = 0; p0 < world.pieceCount; p0++) {
    if (!world.pAlive[p0]) continue;
    const col = world.pCol[p0];
    const b = p0 * 12;
    ctx.strokeStyle = '#3A404A';
    ctx.lineWidth = world.pHt[p0] * 2;
    ctx.beginPath();
    const a0 = world.colAngle[col] + dmath.atan2(world.pData[b + 5], world.pData[b + 4]);
    ctx.arc(world.colX[col], world.colY[col], world.pData[b + 2], a0, a0 + world.pData[b + 3]);
    ctx.stroke();
  }
  // Tethers
  ctx.lineWidth = 0.6;
  for (let t = 0; t < world.tetherHigh; t++) {
    if (!world.tAlive[t]) continue;
    const i = world.tBody[t];
    const hue = balls.find((b) => world.indexOf(b.h) === i)?.hue ?? 0;
    world.tetherAnchor(t, p);
    ctx.strokeStyle = `hsla(${hue}, 90%, 65%, 0.35)`;
    ctx.beginPath();
    ctx.moveTo(world.x[i], world.y[i]);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  // Balls
  for (const b of balls) {
    const i = world.indexOf(b.h);
    if (i < 0) continue;
    ctx.fillStyle = `hsl(${b.hue}, 90%, 62%)`;
    ctx.beginPath();
    ctx.arc(world.x[i], world.y[i], world.r[i], 0, dmath.TAU);
    ctx.fill();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
