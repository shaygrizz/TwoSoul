// Мобы: слайм (прыгает к герою), летучая мышь (пикирует), гриб (стреляет спорами).
import { CFG } from '../config.js';
import { moveBox, boxBlocked, dist2, clamp } from './physics.js';

export function createMob(type, x, y, rnd) {
  const def = CFG.MOBS[type];
  if (!def) throw new Error(`Неизвестный моб: ${type}`);
  return {
    type, x, y, z: type === 'bat' ? def.height : 0,
    homeX: x, homeY: y,
    px: x, py: y, pz: type === 'bat' ? def.height : 0, // прошлый шаг, для интерполяции
    vx: 0, vy: 0, kx: 0, ky: 0,
    hp: def.hp, alive: true, respawnT: 0,
    flash: 0, facing: 1,
    state: 'rest', stateT: 0.3 + rnd() * 1.0,
    hopT: 0, hopDur: 0.4,
    angle: rnd() * Math.PI * 2,
    fireT: 1 + rnd(), shootT: 0,
    t: rnd() * 10,
    // Орда: вариант внешности, разброс скорости, куда поворачивает у препятствий, куда бежит король.
    variant: type === 'zombie' ? Math.floor(rnd() * def.variants) : 0,
    speedMul: type === 'zombie' ? 0.8 + rnd() * 0.45 : 1,
    turn: rnd() < 0.5 ? 1 : -1, dirX: 1, dirY: 0, panic: 0, collapseT: 0,
  };
}

// Зомби появляется в точке (x, y) вместо погибшего.
export function reviveZombie(m, x, y, rnd) {
  const def = CFG.MOBS.zombie;
  m.alive = true; m.hp = def.hp;
  m.x = x; m.y = y; m.px = x; m.py = y; m.z = 0; m.pz = 0;
  m.kx = 0; m.ky = 0; m.vx = 0; m.vy = 0;
  m.collapseT = 0; m.flash = 0;
  m.variant = Math.floor(rnd() * def.variants);
  m.speedMul = 0.8 + rnd() * 0.45;
  m.turn = rnd() < 0.5 ? 1 : -1;
  m.t = rnd() * 10;
}

export function isHorde(m) { return m.type === 'zombie' || m.type === 'king'; }

// ctx: { target (герой или null), blocked, rnd, map, spawnSpore(m, dx, dy) }
export function updateMob(m, dt, ctx) {
  m.px = m.x; m.py = m.y; m.pz = m.z;
  if (!m.alive) return;
  const def = CFG.MOBS[m.type];
  m.t += dt;
  m.flash = Math.max(0, m.flash - dt);
  m.shootT = Math.max(0, m.shootT - dt);

  const tgt = ctx.target && !ctx.target.dead ? ctx.target : null;
  const near = tgt && dist2(m.x, m.y, tgt.x, tgt.y) < def.aggro * def.aggro;

  if (m.type === 'slime') updateSlime(m, dt, def, tgt, near, ctx);
  else if (m.type === 'bat') updateBat(m, dt, def, tgt, near, ctx);
  else if (m.type === 'mushroom') updateMushroom(m, dt, def, tgt, near, ctx);
  else if (m.type === 'zombie') updateZombie(m, dt, def, tgt, ctx);
  else if (m.type === 'king') updateKing(m, dt, def, tgt, ctx);

  // Отбрасывание от попаданий.
  if (m.kx !== 0 || m.ky !== 0) {
    if (m.type === 'bat') { m.x += m.kx * dt; m.y += m.ky * dt; }
    else moveBox(m, m.kx * dt, m.ky * dt, def.radius - 1, 3, ctx.blocked);
    const k = Math.min(1, 7 * dt);
    m.kx -= m.kx * k; m.ky -= m.ky * k;
    if (Math.abs(m.kx) < 1 && Math.abs(m.ky) < 1) { m.kx = 0; m.ky = 0; }
  }

  m.x = clamp(m.x, 8, ctx.map.pxW - 8);
  m.y = clamp(m.y, 8, ctx.map.pxH - 8);
  if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) { m.x = m.homeX; m.y = m.homeY; }
}

// Направление шага с обходом препятствий: если прямо впереди стена, пробуем повернуть на всё больший угол
// в ту сторону, которую зомби выбрал раньше (так он не мечется туда-сюда).
const TURNS = [0, 0.6, 1.2, 1.9];
function steer(m, ax, ay, hw, ctx) {
  for (const t of TURNS) {
    const a = t * m.turn, c = Math.cos(a), s = Math.sin(a);
    const dx = ax * c - ay * s, dy = ax * s + ay * c;
    if (!boxBlocked(m.x + dx * 9, m.y + dy * 7, hw, 3, ctx.blocked)) return [dx, dy];
  }
  return [ax, ay];
}

function updateZombie(m, dt, def, tgt, ctx) {
  m.z = 0;
  if (m.collapseT > 0 || !tgt) { m.vx *= 0.8; m.vy *= 0.8; return; }   // рассыпается или некого преследовать
  const dx = tgt.x - m.x, dy = tgt.y - m.y;
  const d = Math.hypot(dx, dy) || 1;
  const [sx, sy] = steer(m, dx / d, dy / d, def.radius - 1, ctx);
  const sp = def.speed * m.speedMul * (d < 50 ? 1.15 : 1);
  const k = Math.min(1, dt * 6);
  m.vx += (sx * sp - m.vx) * k; m.vy += (sy * sp - m.vy) * k;
  moveBox(m, m.vx * dt, m.vy * dt, def.radius - 1, 3, ctx.blocked);
  if (Math.abs(m.vx) > 2) m.facing = m.vx > 0 ? 1 : -1;
}

// Король: пока герой далеко, стоит. Как только герой ближе fleeDist, бежит прочь, выбирая из 16 направлений
// то, что ведёт от героя и не упирается в препятствие (чем свободнее путь, тем лучше), и тянется от краёв к центру.
const KING_DIRS = 16;
function clearance(m, c, s, hw, ctx) {
  for (let k = 1; k <= 6; k++) {
    if (boxBlocked(m.x + c * 6 * k, m.y + s * 6 * k * 0.8, hw, 3, ctx.blocked)) return (k - 1) / 6;
  }
  return 1;
}

function updateKing(m, dt, def, tgt, ctx) {
  m.z = 0;
  m.panic = Math.max(0, m.panic - dt);
  const dx = tgt ? m.x - tgt.x : 0, dy = tgt ? m.y - tgt.y : 0;
  const d = Math.hypot(dx, dy) || 1;
  const afraid = tgt && d < def.fleeDist * (m.panic > 0 ? 1.4 : 1);
  if (!afraid) {
    const k = Math.min(1, dt * 6);
    m.vx -= m.vx * k; m.vy -= m.vy * k;
    m.fleeing = false;
    return;
  }
  m.fleeing = true;
  const ax = dx / d, ay = dy / d;
  const cx = ctx.map.pxW / 2 - m.x, cy = ctx.map.pxH / 2 - m.y, cl = Math.hypot(cx, cy) || 1;
  const hw = def.radius - 1;
  let bx = ax, by = ay, best = -1e9;
  for (let i = 0; i < KING_DIRS; i++) {
    const a = (i / KING_DIRS) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const clr = clearance(m, c, s, hw, ctx);
    const score = c * ax + s * ay + clr * 1.3 - (clr < 0.35 ? 1.2 : 0) + ((c * cx + s * cy) / cl) * 0.25 + (c * m.dirX + s * m.dirY) * 0.3;
    if (score > best) { best = score; bx = c; by = s; }
  }
  m.dirX = bx; m.dirY = by;
  const sp = def.speed * (m.panic > 0 ? 1.3 : 1) * (d < 50 ? 1.15 : 1);
  const k = Math.min(1, dt * 8);
  m.vx += (bx * sp - m.vx) * k; m.vy += (by * sp - m.vy) * k;
  moveBox(m, m.vx * dt, m.vy * dt, hw, 3, ctx.blocked);
  if (Math.abs(m.vx) > 2) m.facing = m.vx > 0 ? 1 : -1;
}

function updateSlime(m, dt, def, tgt, near, ctx) {
  if (m.state === 'rest') {
    m.stateT -= dt;
    m.z = 0;
    if (m.stateT <= 0) {
      let dx, dy;
      const homeD2 = dist2(m.x, m.y, m.homeX, m.homeY);
      if (near) { dx = tgt.x - m.x; dy = tgt.y - m.y; }
      else if (homeD2 > 60 * 60) { dx = m.homeX - m.x; dy = m.homeY - m.y; }
      else { const a = ctx.rnd() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); }
      const l = Math.hypot(dx, dy) || 1;
      const sp = def.speed * (near ? 2.0 : 1.2);
      m.vx = (dx / l) * sp; m.vy = (dy / l) * sp;
      if (Math.abs(m.vx) > 1) m.facing = m.vx > 0 ? 1 : -1;
      m.state = 'hop'; m.hopT = 0; m.hopDur = near ? 0.38 : 0.45;
    }
  } else {
    m.hopT += dt;
    const p = Math.min(1, m.hopT / m.hopDur);
    m.z = Math.sin(p * Math.PI) * (near ? 8 : 5);
    moveBox(m, m.vx * dt, m.vy * dt, def.radius - 1, 3, ctx.blocked);
    if (p >= 1) {
      m.state = 'rest'; m.z = 0;
      m.stateT = near ? 0.3 + ctx.rnd() * 0.3 : 0.7 + ctx.rnd() * 1.2;
    }
  }
}

function updateBat(m, dt, def, tgt, near, ctx) {
  m.z = def.height + Math.sin(m.t * 7) * 3;
  const homeD = Math.sqrt(dist2(m.x, m.y, m.homeX, m.homeY));
  if (m.state === 'swoop') {
    m.stateT -= dt;
    m.x += m.vx * dt; m.y += m.vy * dt;
    if (m.stateT <= 0 || homeD > def.leash + 50) { m.state = 'rest'; m.stateT = 1.4 + ctx.rnd(); }
  } else {
    m.angle += dt * 1.3;
    const gx = m.homeX + Math.cos(m.angle) * 30;
    const gy = m.homeY + Math.sin(m.angle * 1.7) * 16;
    const dx = gx - m.x, dy = gy - m.y;
    const l = Math.hypot(dx, dy) || 1;
    const sp = Math.min(def.speed, l * 4);
    m.vx = (dx / l) * sp; m.vy = (dy / l) * sp;
    m.x += m.vx * dt; m.y += m.vy * dt;
    m.stateT -= dt;
    if (near && m.stateT <= 0 && homeD < def.leash) {
      const tx = tgt.x - m.x, ty = tgt.y - m.y;
      const tl = Math.hypot(tx, ty) || 1;
      m.vx = (tx / tl) * def.speed * 1.7; m.vy = (ty / tl) * def.speed * 1.7;
      m.state = 'swoop'; m.stateT = 0.9;
    }
  }
  if (Math.abs(m.vx) > 2) m.facing = m.vx > 0 ? 1 : -1;
}

function updateMushroom(m, dt, def, tgt, near, ctx) {
  m.z = 0;
  if (!near) { m.fireT = Math.max(m.fireT, 0.8); return; }
  m.facing = tgt.x > m.x ? 1 : -1;
  m.fireT -= dt;
  if (m.fireT <= 0) {
    m.fireT = def.fireEvery;
    m.shootT = 0.3;
    const dx = tgt.x - m.x, dy = tgt.y - m.y;
    const l = Math.hypot(dx, dy) || 1;
    ctx.spawnSpore(m, dx / l, dy / l);
  }
}

// Возвращает true, если моб погиб.
export function damageMob(m, dmg, dirX, dirY) {
  if (!m.alive) return false;
  const def = CFG.MOBS[m.type];
  m.hp -= dmg;
  m.flash = 0.15;
  m.kx = dirX * def.knock; m.ky = dirY * def.knock;
  if (m.hp <= 0) {
    m.alive = false;
    m.respawnT = def.respawn;
    return true;
  }
  return false;
}

export function respawnMob(m) {
  const def = CFG.MOBS[m.type];
  m.alive = true; m.hp = def.hp;
  m.x = m.homeX; m.y = m.homeY;
  m.kx = 0; m.ky = 0; m.vx = 0; m.vy = 0;
  m.state = 'rest'; m.stateT = 1;
  m.z = m.type === 'bat' ? def.height : 0;
  m.px = m.x; m.py = m.y; m.pz = m.z;
}

// Вертикальный диапазон тела моба (для попаданий снарядов).
export function mobBodyZ(m) {
  const def = CFG.MOBS[m.type];
  if (m.type === 'bat') return [m.z - 7, m.z + 7];
  return [m.z, m.z + def.height];
}
