// Испытание «Огонь и вода». Огонь ходит по лаве, вода по воде, кислота опасна обоим.
// Плиты открывают двери, пока на них кто-то стоит. Победа: оба на своих выходах.
// Интерфейс испытания: start, update, finish.
import { FIRE_WATER } from '../core/maps.js';
import { TileMap, TRIAL_LEGEND, T, tileCenter, toTile } from '../core/tilemap.js';
import { createHero, updateHero, reviveHero } from '../core/hero.js';
import { CFG } from '../config.js';

const GEMS = [
  { tx: 3, ty: 8, el: 'fire' }, { tx: 6, ty: 12, el: 'fire' }, { tx: 2, ty: 15, el: 'fire' }, { tx: 9, ty: 3, el: 'fire' },
  { tx: 19, ty: 8, el: 'water' }, { tx: 17, ty: 13, el: 'water' }, { tx: 21, ty: 12, el: 'water' }, { tx: 14, ty: 3, el: 'water' },
];

const WIN_DELAY = 2.2;
const DEATH_DELAY = 0.9;

export const fireWater = {
  id: 'fireWater',
  title: 'Огонь и вода',

  // playerKind: за кого играет человек ('her' | 'him').
  start({ playerKind }) {
    const map = new TileMap(FIRE_WATER, TRIAL_LEGEND);
    const heroes = [];
    for (const kind of ['him', 'her']) {
      const element = CFG.HEROES[kind].element;
      const st = map.mark(element === 'fire' ? 'startFire' : 'startWater');
      const c = tileCenter(st.tx, st.ty);
      const h = createHero(kind, c.x, c.y);
      h.element = element;
      h.startX = c.x; h.startY = c.y;
      h.facing = element === 'fire' ? -1 : 1;
      heroes.push(h);
    }
    const plates = ['1', '2'].map((id) => ({ id, ...map.mark('plate' + id), pressed: false }));
    const doors = ['1', '2'].map((id) => ({ id, tiles: map.marks['door' + id] || [], isOpen: false, open: 0 }));
    const exitF = map.mark('exitFire'), exitW = map.mark('exitWater');

    const s = {
      map, heroes, plates, doors,
      exits: { fire: exitF, water: exitW },
      gems: GEMS.map((g) => ({ ...tileCenter(g.tx, g.ty), el: g.el, taken: false })),
      active: Math.max(0, heroes.findIndex((h) => h.kind === playerKind)),
      won: false, wonT: 0, done: false, time: 0,
      events: [],
    };
    s.blocked = (tx, ty) => map.blockedWalk(tx, ty) || closedDoorAt(s, tx, ty);
    return s;
  },

  // inputs[i] — ввод для heroes[i].
  update(s, inputs, dt) {
    if (s.done) return;
    if (!s.won) s.time += dt;

    s.heroes.forEach((h, i) => {
      const emit = (type) => s.events.push({ type, x: h.x, y: h.y, z: h.z, kind: h.kind, element: h.element });
      updateHero(h, inputs[i], dt, { blocked: s.blocked, canShoot: false, canDash: false, onEvent: emit });
      if (h.dead && h.deadT <= 0) {
        reviveHero(h, h.startX, h.startY);
        s.events.push({ type: 'respawn', x: h.x, y: h.y, z: 0, kind: h.kind, element: h.element });
      }
    });

    for (const h of s.heroes) checkHazard(s, h);
    updatePlatesAndDoors(s, dt);
    collectGems(s);

    if (!s.won && s.heroes.every((h) => onExit(s, h))) {
      s.won = true;
      for (const h of s.heroes) h.cheer = true;
      s.events.push({ type: 'win', x: 0, y: 0, z: 0 });
    }
    if (s.won) {
      s.wonT += dt;
      if (s.wonT >= WIN_DELAY) s.done = true;
    }
  },

  finish(s) {
    const taken = s.gems.filter((g) => g.taken).length;
    return { gems: taken, totalGems: s.gems.length, time: s.time };
  },
};

export function swapActive(s) {
  if (s.won) return;
  s.active = (s.active + 1) % s.heroes.length;
}

function closedDoorAt(s, tx, ty) {
  for (const d of s.doors) {
    if (d.isOpen) continue;
    for (const t of d.tiles) if (t.tx === tx && t.ty === ty) return true;
  }
  return false;
}

function grounded(h) { return !h.dead && h.z < 1; }

function heroTile(h) { return { tx: toTile(h.x), ty: toTile(h.y) }; }

function checkHazard(s, h) {
  if (!grounded(h) || s.won) return;
  const { tx, ty } = heroTile(h);
  const t = s.map.terrainAt(tx, ty);
  const deadly = t === T.ACID
    || (t === T.LAVA && h.element !== 'fire')
    || (t === T.POOL && h.element !== 'water');
  if (!deadly) return;
  h.dead = true;
  h.deadT = DEATH_DELAY;
  h.vx = 0; h.vy = 0;
  s.events.push({ type: 'trialDeath', x: h.x, y: h.y, z: 0, kind: h.kind, element: h.element, terrain: t });
}

function heroOverlapsTile(h, tx, ty) {
  const T0 = CFG.TILE, hw = CFG.HERO.halfW, hh = CFG.HERO.halfH;
  return h.x + hw > tx * T0 && h.x - hw < (tx + 1) * T0 && h.y + hh > ty * T0 && h.y - hh < (ty + 1) * T0;
}

function updatePlatesAndDoors(s, dt) {
  for (const p of s.plates) {
    const was = p.pressed;
    p.pressed = s.heroes.some((h) => grounded(h) && toTile(h.x) === p.tx && toTile(h.y) === p.ty);
    if (p.pressed !== was) s.events.push({ type: p.pressed ? 'plateDown' : 'plateUp', ...tileCenter(p.tx, p.ty), z: 0 });
  }
  for (const d of s.doors) {
    const plate = s.plates.find((p) => p.id === d.id);
    const pressed = Boolean(plate && plate.pressed);
    // Дверь не закрывается на герое, чтобы его не зажало.
    const occupied = d.tiles.some((t) => s.heroes.some((h) => heroOverlapsTile(h, t.tx, t.ty)));
    const was = d.isOpen;
    d.isOpen = pressed || (d.isOpen && occupied);
    if (d.isOpen !== was && d.tiles.length > 0) {
      s.events.push({ type: d.isOpen ? 'doorOpen' : 'doorClose', ...tileCenter(d.tiles[0].tx, d.tiles[0].ty), z: 0 });
    }
    const target = d.isOpen ? 1 : 0;
    d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 6);
  }
}

function collectGems(s) {
  for (const g of s.gems) {
    if (g.taken) continue;
    for (const h of s.heroes) {
      if (h.dead || h.element !== g.el || h.z > 14) continue;
      const dx = h.x - g.x, dy = h.y - g.y;
      if (dx * dx + dy * dy < 10 * 10) {
        g.taken = true;
        s.events.push({ type: 'gem', x: g.x, y: g.y, z: 8, element: g.el });
        break;
      }
    }
  }
}

function onExit(s, h) {
  if (!grounded(h)) return false;
  const e = s.exits[h.element];
  return Boolean(e) && toTile(h.x) === e.tx && toTile(h.y) === e.ty;
}
