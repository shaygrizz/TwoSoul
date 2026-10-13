// Логика героя: бег, прыжок, рывок, выстрел, урон. Без отрисовки.
import { CFG } from '../config.js';
import { moveBox } from './physics.js';

const H = CFG.HERO;

export const EMPTY_INPUT = Object.freeze({ mx: 0, my: 0, jump: false, shoot: false, dash: false, sprint: false, aim: null, aimDir: null, switchWeapon: false, slot: -1 });

export function createHero(kind, x, y) {
  return {
    kind, x, y, z: 0, vx: 0, vy: 0, vz: 0,
    px: x, py: y, pz: 0,  // позиция на прошлом шаге — для плавной интерполяции при отрисовке
    facing: 1, dirX: 1, dirY: 0,
    aimX: 1, aimY: 0,     // куда смотрит ствол (единичный вектор)
    aimByMouse: false,    // прицел задан мышью
    gun: null,            // текущее оружие (id из CFG.WEAPONS) или null
    weapons: [], weaponIdx: 0,
    swingT: 0, swingHit: false, // замах оружия ближнего боя: время с начала и был ли уже удар
    hp: H.maxHp, inv: 0, hurtT: 0,
    dashT: 0, dashCd: 0, dashX: 0, dashY: 0,
    sprint: false,        // зажат бег (Shift) и герой действительно движется
    shootCd: 0, castT: 0, landT: 0,
    dead: false, deadT: 0, cheer: false,
    anim: 'idle', animT: 0,
    safeX: x, safeY: y,
  };
}

export function placeHero(h, x, y) {
  h.x = x; h.y = y; h.z = 0; h.vx = 0; h.vy = 0; h.vz = 0;
  h.px = x; h.py = y; h.pz = 0; // телепорт без «размазывания»
  h.dashT = 0; h.safeX = x; h.safeY = y;
}

// ctx: { blocked, canShoot, canDash, onShoot(h, dx, dy), onMelee(h, dx, dy), aimAssist(h) -> {x,y}|null, onEvent(type, h) }
export function updateHero(h, inp, dt, ctx) {
  h.px = h.x; h.py = h.y; h.pz = h.z;
  h.inv = Math.max(0, h.inv - dt);
  h.hurtT = Math.max(0, h.hurtT - dt);
  h.dashCd = Math.max(0, h.dashCd - dt);
  h.shootCd = Math.max(0, h.shootCd - dt);
  h.castT = Math.max(0, h.castT - dt);
  h.landT = Math.max(0, h.landT - dt);

  if (h.dead) {
    h.deadT -= dt;
    h.vx = 0; h.vy = 0;
    setAnim(h, 'hurt', dt);
    return;
  }

  let mx = Number.isFinite(inp.mx) ? inp.mx : 0;
  let my = Number.isFinite(inp.my) ? inp.my : 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  if (h.cheer) { mx = 0; my = 0; }
  if (len > 0.05) {
    const l = Math.hypot(mx, my) || 1;
    h.dirX = mx / l; h.dirY = my / l;
    if (Math.abs(mx) > 0.12) h.facing = mx > 0 ? 1 : -1;
  }
  if (ctx.canShoot) switchWeapon(h, inp, ctx);
  if (h.gun) updateAim(h, inp, ctx);
  if (h.hurtT > 0) { mx *= 0.3; my *= 0.3; }
  h.sprint = Boolean(inp.sprint) && len > 0.05 && !h.cheer && h.hurtT <= 0;
  const speed = H.speed * (h.sprint ? H.sprintMul : 1);

  if (inp.jump && h.z === 0 && h.dashT <= 0 && !h.cheer) {
    h.vz = H.jumpV;
    ctx.onEvent?.('jump', h);
  }

  if (inp.dash && ctx.canDash && h.dashCd <= 0 && h.hurtT <= 0) {
    h.dashT = H.dashTime;
    h.dashCd = H.dashCooldown;
    h.dashX = h.dirX; h.dashY = h.dirY;
    if (Math.abs(h.dashX) > 0.12) h.facing = h.dashX > 0 ? 1 : -1;
    ctx.onEvent?.('dash', h);
  }

  if (h.dashT > 0) {
    h.dashT -= dt;
    h.vx = h.dashX * H.dashSpeed;
    h.vy = h.dashY * H.dashSpeed;
  } else if (h.hurtT <= 0) {
    const k = Math.min(1, H.accel * dt);
    h.vx += (mx * speed - h.vx) * k;
    h.vy += (my * speed - h.vy) * k;
  } else {
    // Отбрасывание затухает.
    const k = Math.min(1, 8 * dt);
    h.vx -= h.vx * k; h.vy -= h.vy * k;
  }

  moveBox(h, h.vx * dt, h.vy * dt, H.halfW, H.halfH, ctx.blocked);

  if (h.z > 0 || h.vz > 0) {
    h.vz -= H.gravity * dt;
    h.z += h.vz * dt;
    if (h.z <= 0) {
      h.z = 0; h.vz = 0;
      h.landT = H.landTime;
      ctx.onEvent?.('land', h);
    }
  }

  const W = h.gun ? CFG.WEAPONS[h.gun] : null;
  if (inp.shoot && ctx.canShoot && W && h.shootCd <= 0 && h.hurtT <= 0 && h.dashT <= 0) {
    if (Math.abs(h.aimX) > 0.12) h.facing = h.aimX > 0 ? 1 : -1;
    h.shootCd = W.cooldown;
    if (W.type === 'melee') {
      h.swingT = 0.0001; h.swingHit = false; h.castT = W.swingTime;
      ctx.onEvent?.('swing', h);
    } else {
      ctx.onShoot?.(h, h.aimX, h.aimY);
    }
  }
  // Замах: удар засчитывается в середине движения, а не в момент нажатия.
  if (h.swingT > 0) {
    const M = W && W.type === 'melee' ? W : null;
    if (!M) h.swingT = 0;
    else {
      h.swingT += dt;
      if (!h.swingHit && h.swingT >= M.impactAt) { h.swingHit = true; ctx.onMelee?.(h, h.aimX, h.aimY); }
      if (h.swingT >= M.swingTime) h.swingT = 0;
    }
  }

  // Защита от NaN: откат к последней хорошей позиции.
  if (!Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) {
    placeHero(h, h.safeX, h.safeY);
  } else if (h.z === 0) {
    h.safeX = h.x; h.safeY = h.y;
  }

  setAnim(h, pickAnim(h), dt);
}

// Смена оружия: следующее по кругу или конкретный слот. Во время замаха не меняем.
function switchWeapon(h, inp, ctx) {
  const n = h.weapons.length;
  if (n < 2 || h.swingT > 0) return;
  let idx = h.weaponIdx;
  if (Number.isInteger(inp.slot) && inp.slot >= 0 && inp.slot < n) idx = inp.slot;
  else if (inp.switchWeapon) idx = (idx + 1) % n;
  if (idx === h.weaponIdx) return;
  h.weaponIdx = idx;
  h.gun = h.weapons[idx];
  h.shootCd = Math.max(h.shootCd, 0.15);
  ctx.onEvent?.('switch', h);
}

export function equipWeapons(h, list, idx = 0) {
  h.weapons = list.filter((id) => CFG.WEAPONS[id]);
  h.weaponIdx = Math.min(Math.max(0, idx | 0), Math.max(0, h.weapons.length - 1));
  h.gun = h.weapons[h.weaponIdx] || null;
}

// Направление ствола: мышь, затем автоприцел, затем направление движения.
function updateAim(h, inp, ctx) {
  // Направление с сенсорного прицела: тело тоже поворачивается туда.
  const d = inp.aimDir;
  if (d && Number.isFinite(d.x) && Number.isFinite(d.y) && Math.hypot(d.x, d.y) > 0.5) {
    const l = Math.hypot(d.x, d.y);
    h.aimX = d.x / l; h.aimY = d.y / l;
    h.aimByMouse = true;
    if (Math.abs(h.aimX) > 0.12) h.facing = h.aimX > 0 ? 1 : -1;
    return;
  }
  let tx = null, ty = null;
  h.aimByMouse = Boolean(inp.aim);
  if (inp.aim && Number.isFinite(inp.aim.x) && Number.isFinite(inp.aim.y)) { tx = inp.aim.x; ty = inp.aim.y; }
  else {
    const t = ctx.aimAssist?.(h);
    if (t) { tx = t.x; ty = t.y; }
  }
  if (tx !== null) {
    const dx = tx - h.x, dy = ty - h.y;
    const l = Math.hypot(dx, dy);
    if (l > 2) {
      h.aimX = dx / l; h.aimY = dy / l;
      if (inp.aim && Math.abs(dx) > 3) h.facing = dx > 0 ? 1 : -1;
      return;
    }
  }
  h.aimX = h.dirX; h.aimY = h.dirY;
}

function pickAnim(h) {
  if (h.hurtT > 0) return 'hurt';
  if (h.cheer) return 'cheer';
  if (h.dashT > 0) return 'dash';
  if (h.z > 0) return h.vz > 0 ? 'jump' : 'fall';
  if (h.landT > 0) return 'land';
  if (h.castT > 0 && (!h.gun || CFG.WEAPONS[h.gun].type === 'melee')) return 'cast';
  if (Math.hypot(h.vx, h.vy) > 10) return h.sprint ? 'run' : 'walk';
  return 'idle';
}

function setAnim(h, name, dt) {
  if (h.anim !== name) { h.anim = name; h.animT = 0; } else h.animT += dt;
}

// Возвращает true, если урон прошёл.
export function hurtHero(h, dmg, fromX, fromY, onEvent) {
  if (h.dead || h.inv > 0 || h.cheer) return false;
  h.hp = Math.max(0, h.hp - dmg);
  h.inv = H.iframes;
  h.hurtT = H.hurtTime;
  h.dashT = 0;
  const dx = h.x - fromX, dy = h.y - fromY;
  const l = Math.hypot(dx, dy) || 1;
  h.vx = (dx / l) * 110; h.vy = (dy / l) * 110;
  if (h.hp <= 0) {
    h.dead = true;
    h.deadT = H.respawnDelay;
    onEvent?.('heroDown', h);
  } else {
    onEvent?.('heroHurt', h);
  }
  return true;
}

export function reviveHero(h, x, y) {
  placeHero(h, x, y);
  h.dead = false;
  h.hp = H.maxHp;
  h.inv = 1.5;
  h.hurtT = 0;
}
