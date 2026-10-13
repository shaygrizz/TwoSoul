// Мир: герой, мобы, снаряды, сердечки, вход в испытание. Только логика.
import { CFG } from '../config.js';
import { OVERWORLD } from './maps.js';
import { TileMap, OVERWORLD_LEGEND, tileCenter, toTile } from './tilemap.js';
import { createHero, updateHero, hurtHero, reviveHero, placeHero, equipWeapons } from './hero.js';
import { createTrees, chopAt, updateTrees, nearestTree } from './trees.js';
import { createMob, updateMob, damageMob, respawnMob, mobBodyZ } from './mobs.js';
import { createPool, makeProjectile, spawnProjectile, updateProjectiles, makePickup } from './projectiles.js';
import { dist2 } from './physics.js';
import { makeRng } from './rng.js';

export function createOverworld(heroKind, saved) {
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
  return w;
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

  updateTrees(w, dt, hero, (x, y) => dropPickup(w, 'wood', x, y));

  if (hero.dead && hero.deadT <= 0) {
    reviveHero(hero, w.spawn.x, w.spawn.y);
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
      m.respawnT -= dt;
      if (m.respawnT <= 0 && dist2(hero.x, hero.y, m.homeX, m.homeY) > 140 * 140) respawnMob(m);
      continue;
    }
    updateMob(m, dt, mobCtx);
    // Касание моба ранит героя. Через слайма и гриб можно перепрыгнуть.
    const def = CFG.MOBS[m.type];
    const r = def.radius + 5;
    if (dist2(hero.x, hero.y, m.x, m.y) < r * r) {
      const jumpedOver = m.type !== 'bat' && hero.z > CFG.HERO.jumpSafeZ + m.z;
      if (!jumpedOver) hurtHero(hero, 1, m.x, m.y, emit);
    }
  }

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
        w.events.push({ type: killed ? 'kill' : 'hit', x: m.x, y: m.y, z: m.z + 6, mob: m.type, dx: p.vx / l, dy: p.vy / l, idx: w.mobs.indexOf(m) });
        if (killed) {
          w.kills++;
          if (w.rnd() < CFG.HEART_DROP_CHANCE) dropHeart(w, m.x, m.y);
        }
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
    w.events.push({ type: killed ? 'kill' : 'hit', x: m.x, y: m.y, z: m.z + 6, mob: m.type, dx: ax, dy: ay, idx: w.mobs.indexOf(m) });
    if (killed) {
      w.kills++;
      if (w.rnd() < CFG.HEART_DROP_CHANCE) dropHeart(w, m.x, m.y);
    }
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
