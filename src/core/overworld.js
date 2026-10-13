// Мир: герой, мобы, снаряды, сердечки, вход в испытание. Только логика.
import { CFG } from '../config.js';
import { OVERWORLD } from './maps.js';
import { TileMap, OVERWORLD_LEGEND, tileCenter, toTile } from './tilemap.js';
import { createHero, updateHero, hurtHero, reviveHero, placeHero, equipWeapons } from './hero.js';
import { createTrees, chopAt, updateTrees, nearestTree } from './trees.js';
import { createMob, updateMob, damageMob, respawnMob, reviveZombie, isHorde, mobBodyZ } from './mobs.js';
import { createPool, makeProjectile, spawnProjectile, updateProjectiles, makePickup } from './projectiles.js';
import { dist2, boxBlocked, moveBox } from './physics.js';
import { makeRng } from './rng.js';

export function createOverworld(heroKind, saved, opts = {}) {
  const map = new TileMap(OVERWORLD, OVERWORLD_LEGEND);
  const spawnTile = map.mark('spawn');
  const gateTile = map.mark('gate');
  const spawn = tileCenter(spawnTile.tx, spawnTile.ty);
  const rnd = makeRng(1234);

  const hero = createHero(heroKind, spawn.x, spawn.y);
  equipWeapons(hero, CFG.HEROES[heroKind].weapons, saved && saved.weaponIdx);
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      && !map.blockedWalk(toTile(saved.x), toTile(saved.y))) {
    placeHero(hero, saved.x, saved.y);
  }
  if (saved && Number.isInteger(saved.hp) && saved.hp > 0) hero.hp = Math.min(saved.hp, CFG.HERO.maxHp);

  const mobs = [];
  for (const type of ['slime', 'bat', 'mushroom']) {
    for (const t of map.marks[type] || []) {
      const c = tileCenter(t.tx, t.ty);
      mobs.push(createMob(type, c.x, c.y, rnd));
    }
  }

  const w = {
    map, hero, mobs, rnd, spawn,
    gate: tileCenter(gateTile.tx, gateTile.ty), gateTile,
    gateLatch: true, // не срабатывает, пока герой не отойдёт
    projectiles: createPool(48, makeProjectile),
    pickups: createPool(24, makePickup),
    trees: createTrees(map),
    wood: saved && Number.isInteger(saved.wood) && saved.wood >= 0 ? saved.wood : 0,
    events: [],
    kills: saved && Number.isInteger(saved.kills) ? saved.kills : 0,
    time: 0,
  };
  w.blocked = (tx, ty) => map.blockedWalk(tx, ty);
  w.super = { charge: 0 };   // сколько убийств накоплено для суперудара
  w.wave = null;             // волна суперудара, пока расходится
  w.kingDead = Boolean(saved && saved.kingDead);
  w.king = null;
  w.view = { hw: 260, hh: 170 };   // половина видимой области в пикселях мира: main обновляет каждый кадр
  if (opts.horde !== false && !w.kingDead) addHorde(w);
  return w;
}

// ---------- орда зомби и король ----------

// Случайная проходимая точка карты не ближе minDist к герою; outsideView — ещё и за пределами экрана.
function pickSpot(w, minDist, outsideView) {
  const { map, hero, view } = w;
  const m2 = minDist * minDist, r = CFG.MOBS.zombie.radius - 1;
  for (let i = 0; i < 40; i++) {
    const tx = Math.floor(w.rnd() * map.w), ty = Math.floor(w.rnd() * map.h);
    const p = tileCenter(tx, ty);
    if (boxBlocked(p.x, p.y, r, 3, w.blocked)) continue;
    if (dist2(p.x, p.y, hero.x, hero.y) < m2) continue;
    if (outsideView) {
      const mg = CFG.HORDE.viewMargin;
      if (Math.abs(p.x - hero.x) < view.hw + mg && Math.abs(p.y - hero.y) < view.hh + mg) continue;
    }
    return p;
  }
  return null;
}

function addHorde(w) {
  const H = CFG.HORDE;
  w.horde = { active: true, spawnT: 1, alive: 0 };
  for (let i = 0; i < H.cap; i++) {
    const z = createMob('zombie', 0, 0, w.rnd);
    z.alive = false;
    w.mobs.push(z);
  }
  // Король стоит как можно дальше от места, где начинает герой.
  const king = createMob('king', 0, 0, w.rnd);
  let far = null, farD = -1;
  for (let i = 0; i < 80; i++) {
    const p = pickSpot(w, 0, false);
    if (!p) continue;
    const d = dist2(p.x, p.y, w.spawn.x, w.spawn.y);
    if (d > farD) { far = p; farD = d; }
  }
  const at = far || tileCenter(w.map.w - 6, 4);
  king.x = king.px = king.homeX = at.x; king.y = king.py = king.homeY = at.y;
  w.king = king;
  w.mobs.push(king);
  // Карта уже заражена с первой секунды: часть орды сразу разбросана вдали от героя.
  let n = 0;
  for (const z of w.mobs) {
    if (z.type !== 'zombie' || n >= H.initial) continue;
    const p = pickSpot(w, H.minDist + 50, false);
    if (!p) continue;
    reviveZombie(z, p.x, p.y, w.rnd);
    n++;
  }
}

function updateHorde(w, dt) {
  const hd = w.horde;
  if (!hd || !hd.active) return;
  hd.spawnT -= dt;
  if (hd.spawnT > 0) return;
  hd.spawnT = CFG.HORDE.spawnEvery;
  let alive = 0, slot = null;
  for (const m of w.mobs) {
    if (m.type !== 'zombie') continue;
    if (m.alive) alive++;
    else if (!slot && m.collapseT <= 0) slot = m;
  }
  hd.alive = alive;
  if (!slot || alive >= CFG.HORDE.cap) return;
  const p = pickSpot(w, CFG.HORDE.minDist, true);
  if (p) reviveZombie(slot, p.x, p.y, w.rnd);
}

// Зомби не слипаются в одну точку: тех, кто ближе 10 px, мягко раздвигаем.
function separateZombies(w) {
  const zs = [];
  for (const m of w.mobs) if (m.type === 'zombie' && m.alive && m.collapseT <= 0) zs.push(m);
  const R = 10, r = CFG.MOBS.zombie.radius - 1;
  for (let i = 0; i < zs.length; i++) {
    const a = zs[i];
    for (let j = i + 1; j < zs.length; j++) {
      const b = zs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      const d = Math.hypot(dx, dy);
      if (d >= R) continue;
      const push = (R - d) * 0.25;
      const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
      moveBox(a, -nx * push, -ny * push, r, 3, w.blocked);
      moveBox(b, nx * push, ny * push, r, 3, w.blocked);
    }
  }
}

// После смерти короля зомби рассыпаются один за другим: сначала ближайшие к нему.
function kingDown(w, king) {
  w.kingDead = true;
  if (w.horde) w.horde.active = false;
  for (const z of w.mobs) {
    if (z.type !== 'zombie' || !z.alive) continue;
    z.collapseT = 0.4 + Math.sqrt(dist2(z.x, z.y, king.x, king.y)) / 240 + w.rnd() * 0.25;
  }
  w.events.push({ type: 'kingDown', x: king.x, y: king.y, z: 12, idx: w.mobs.indexOf(king) });
}

function updateCollapse(w, dt) {
  for (const z of w.mobs) {
    if (z.type !== 'zombie' || !z.alive || z.collapseT <= 0) continue;
    z.collapseT -= dt;
    if (z.collapseT <= 0) {
      z.alive = false;
      w.events.push({ type: 'zcollapse', x: z.x, y: z.y, z: 10, mob: 'zombie', idx: w.mobs.indexOf(z) });
    }
  }
}

// Событие попадания и награда. У зомби свои события: их много, и каждый не должен давать заморозку кадра.
function mobHit(w, m, killed, dx, dy, bySuper = false) {
  const idx = w.mobs.indexOf(m);
  const horde = isHorde(m);
  w.events.push({ type: horde ? (killed ? 'zkill' : 'zhit') : (killed ? 'kill' : 'hit'), x: m.x, y: m.y, z: m.z + 6, mob: m.type, dx, dy, idx });
  if (m.type === 'king') {
    if (killed) kingDown(w, m);
    else m.panic = 1.6;
  }
  if (killed) {
    w.kills++;
    if (!bySuper && m.type !== 'king' && w.super.charge < CFG.SUPER.kills && ++w.super.charge >= CFG.SUPER.kills) {
      w.events.push({ type: 'superReady', x: w.hero.x, y: w.hero.y, z: 20 });
    }
    const chance = CFG.MOBS[m.type].drop ?? CFG.HEART_DROP_CHANCE;
    if (m.type !== 'king' && w.rnd() < chance) dropHeart(w, m.x, m.y);
  }
}

// Суперудар: от героя расходится волна. Каждого, до кого она дошла, бьёт один раз и отбрасывает наружу.
function fireSuper(w) {
  const hero = w.hero;
  w.super.charge = 0;
  hero.superT = CFG.SUPER.time;
  hero.inv = Math.max(hero.inv, CFG.SUPER.time + 0.15);   // на момент удара герой неуязвим
  w.wave = { x: hero.x, y: hero.y, r: 0, hit: new Set() };
  w.events.push({ type: 'super', x: hero.x, y: hero.y, z: 10 });
}

function updateWave(w, dt) {
  const wave = w.wave;
  if (!wave) return;
  wave.r += CFG.SUPER.speed * dt;
  for (const m of w.mobs) {
    if (!m.alive || wave.hit.has(m)) continue;
    const def = CFG.MOBS[m.type];
    const dx = m.x - wave.x, dy = m.y - wave.y;
    const d = Math.hypot(dx, dy);
    if (d > wave.r + def.radius || d > CFG.SUPER.radius + def.radius) continue;
    wave.hit.add(m);
    const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
    const killed = damageMob(m, m.type === 'king' ? CFG.SUPER.kingDamage : CFG.SUPER.damage, nx, ny);
    if (!killed && m.type !== 'bat') { m.kx = nx * CFG.SUPER.knock; m.ky = ny * CFG.SUPER.knock; }
    mobHit(w, m, killed, nx, ny, true);
  }
  if (wave.r >= CFG.SUPER.radius + 12) w.wave = null;
}

// Убрать зомби рядом с точкой возрождения героя, чтобы орда не караулила его на старте.
function clearAround(w, x, y, r) {
  for (const m of w.mobs) {
    if (m.type === 'zombie' && m.alive && dist2(m.x, m.y, x, y) < r * r) m.alive = false;
  }
}

// Вернуть героя к воротам (после испытания).
export function placeAtGate(w) {
  placeHero(w.hero, w.gate.x, w.gate.y + CFG.TILE * 1.5);
  w.gateLatch = true;
}

export function updateOverworld(w, inp, dt) {
  w.time += dt;
  const hero = w.hero;
  const emit = (type, h) => w.events.push({ type, x: h.x, y: h.y, z: h.z, kind: h.kind });

  updateHero(hero, inp, dt, {
    blocked: w.blocked,
    canShoot: true,
    canDash: true,
    onEvent: emit,
    aimAssist: (h) => findAimTarget(w, h),
    onShoot: (h, ax, ay) => {
      const G = CFG.WEAPONS[h.gun];
      // Небольшой разброс: очередь выглядит живее.
      const a = Math.atan2(ay, ax) + (w.rnd() - 0.5) * 2 * G.spread;
      const dx = Math.cos(a), dy = Math.sin(a);
      const p = spawnProjectile(w.projectiles, G.bullet, 'hero', h.x + dx * 14, h.y + dy * 14, CFG.GUN_HEIGHT, dx * G.speed, dy * G.speed, G.life, G.radius);
      if (p) p.damage = G.damage;
      w.events.push({ type: 'shoot', x: h.x, y: h.y, z: CFG.GUN_HEIGHT, kind: h.kind, dx, dy });
    },
    onMelee: (h, ax, ay) => melee(w, h, ax, ay, emit),
  });

  if (inp.super && !hero.dead && w.super.charge >= CFG.SUPER.kills) fireSuper(w);
  updateWave(w, dt);

  updateTrees(w, dt, hero, (x, y) => dropPickup(w, 'wood', x, y));

  if (hero.dead && hero.deadT <= 0) {
    reviveHero(hero, w.spawn.x, w.spawn.y);
    clearAround(w, w.spawn.x, w.spawn.y, CFG.HORDE.spawnClear);
    w.events.push({ type: 'respawn', x: hero.x, y: hero.y, z: 0 });
  }

  const mobCtx = {
    target: hero, blocked: w.blocked, rnd: w.rnd, map: w.map,
    spawnSpore: (m, dx, dy) => {
      const S = CFG.SPORE;
      spawnProjectile(w.projectiles, 'spore', 'mob', m.x + dx * 6, m.y + dy * 3, S.height, dx * S.speed, dy * S.speed, S.life, S.radius);
    },
  };

  for (const m of w.mobs) {
    if (!m.alive) {
      if (isHorde(m)) continue;   // зомби появляются из орды, король не возрождается
      m.respawnT -= dt;
      if (m.respawnT <= 0 && dist2(hero.x, hero.y, m.homeX, m.homeY) > 140 * 140) respawnMob(m);
      continue;
    }
    updateMob(m, dt, mobCtx);
    // Касание моба ранит героя. Через слайма и гриб можно перепрыгнуть.
    const def = CFG.MOBS[m.type];
    if (def.harmless) continue;
    const r = def.radius + 5;
    if (dist2(hero.x, hero.y, m.x, m.y) < r * r) {
      const jumpedOver = m.type !== 'bat' && hero.z > (def.jumpOver ?? CFG.HERO.jumpSafeZ) + m.z;
      if (!jumpedOver) hurtHero(hero, 1, m.x, m.y, emit);
    }
  }

  updateHorde(w, dt);
  separateZombies(w);
  updateCollapse(w, dt);

  updateProjectiles(w.projectiles, dt, w.map, (p) => w.events.push({ type: 'puff', x: p.x, y: p.y, z: p.z, kind: p.kind }));
  for (const p of w.projectiles) {
    if (!p.active) continue;
    if (p.owner === 'hero') {
      for (const m of w.mobs) {
        if (!m.alive) continue;
        const r = CFG.MOBS[m.type].radius + p.radius;
        if (dist2(p.x, p.y, m.x, m.y) > r * r) continue;
        const [z0, z1] = mobBodyZ(m);
        if (p.z < z0 - 4 || p.z > z1 + 4) continue;
        p.active = false;
        const l = Math.hypot(p.vx, p.vy) || 1;
        const killed = damageMob(m, p.damage, p.vx / l, p.vy / l);
        mobHit(w, m, killed, p.vx / l, p.vy / l);
        break;
      }
    } else if (!hero.dead) {
      const r = 6 + p.radius;
      if (dist2(p.x, p.y, hero.x, hero.y) < r * r && hero.z < CFG.HERO.jumpSafeZ) {
        p.active = false;
        hurtHero(hero, 1, p.x - p.vx, p.y - p.vy, emit);
        w.events.push({ type: 'puff', x: p.x, y: p.y, z: p.z, kind: 'spore' });
      }
    }
  }

  for (const k of w.pickups) {
    if (!k.active) continue;
    k.px = k.x; k.py = k.y;
    k.t += dt;
    if (k.t > (k.kind === 'wood' ? 40 : 15)) { k.active = false; continue; }
    if (hero.dead) continue;
    const d2 = dist2(k.x, k.y, hero.x, hero.y);
    if (k.kind === 'wood') {
      // Дрова сами подлетают к герою, когда он рядом.
      if (k.t > 0.4 && d2 < 40 * 40) {
        const d = Math.sqrt(d2) || 1;
        const sp = 140 * dt;
        k.x += ((hero.x - k.x) / d) * Math.min(sp, d);
        k.y += ((hero.y - k.y) / d) * Math.min(sp, d);
      }
      if (d2 < 8 * 8 && k.t > 0.4) {
        k.active = false;
        w.wood++;
        w.events.push({ type: 'woodGet', x: k.x, y: k.y, z: 6 });
      }
    } else if (hero.hp < CFG.HERO.maxHp && d2 < 11 * 11) {
      k.active = false;
      hero.hp++;
      w.events.push({ type: 'heal', x: k.x, y: k.y, z: 6 });
    }
  }

  // Вход в испытание.
  const onGate = toTile(hero.x) === w.gateTile.tx && toTile(hero.y) === w.gateTile.ty;
  if (onGate && !w.gateLatch && hero.z === 0 && !hero.dead) {
    w.gateLatch = true;
    w.events.push({ type: 'gate', x: hero.x, y: hero.y, z: 0 });
  } else if (!onGate && dist2(hero.x, hero.y, w.gate.x, w.gate.y) > 22 * 22) {
    w.gateLatch = false;
  }
}

function dropHeart(w, x, y) { dropPickup(w, 'heart', x, y); }

function dropPickup(w, kind, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  for (const k of w.pickups) {
    if (k.active) continue;
    k.active = true; k.kind = kind; k.x = x; k.y = y; k.px = x; k.py = y; k.t = 0;
    return;
  }
}

// Удар оружием ближнего боя: мобы и деревья рядом с точкой перед героем.
function melee(w, h, ax, ay, emit) {
  const M = CFG.WEAPONS[h.gun];
  const hx = h.x + ax * M.reach, hy = h.y + ay * M.reach * 0.8;
  let hit = false;
  for (const m of w.mobs) {
    if (!m.alive) continue;
    const r = CFG.MOBS[m.type].radius + M.radius;
    if (dist2(hx, hy, m.x, m.y) > r * r) continue;
    const killed = damageMob(m, M.damage, ax, ay);
    mobHit(w, m, killed, ax, ay);
    hit = true;
  }
  if (chopAt(w, hx, hy, ax)) hit = true;
  if (!hit) emit('swingMiss', h);
}

// Автоприцел: ближайший моб примерно по направлению взгляда; с топором — ещё и дерево рядом.
function findAimTarget(w, h) {
  if (h.gun && CFG.WEAPONS[h.gun].type === 'melee') {
    const t = nearestTree(w, h, 30);
    if (t) return t;
  }
  let best = null, bestD = 150 * 150;
  for (const m of w.mobs) {
    if (!m.alive) continue;
    const dx = m.x - h.x, dy = m.y - h.y;
    const d = dx * dx + dy * dy;
    if (d > bestD || d < 1) continue;
    const l = Math.sqrt(d);
    const dot = (dx / l) * h.dirX + (dy / l) * h.dirY;
    if (dot < 0.35) continue;
    best = m; bestD = d;
  }
  return best;
}
