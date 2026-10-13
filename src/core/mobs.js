// Мобы: слайм (прыгает к герою), летучая мышь (пикирует), гриб (стреляет спорами).
import { CFG } from '../config.js';
import { moveBox, dist2, clamp } from './physics.js';

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
  };
}

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
