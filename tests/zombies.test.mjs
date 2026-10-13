// Орда зомби и король без браузера. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverworld, updateOverworld } from '../src/core/overworld.js';
import { placeHero, EMPTY_INPUT } from '../src/core/hero.js';
import { spawnProjectile } from '../src/core/projectiles.js';
import { CFG } from '../src/config.js';
import { toTile } from '../src/core/tilemap.js';

const DT = CFG.STEP;

function steps(w, n, input = EMPTY_INPUT) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    updateOverworld(w, input, DT);
    for (const e of w.events) seen.push(e.type);
    w.events.length = 0;
  }
  return seen;
}

const zombies = (w) => w.mobs.filter((m) => m.type === 'zombie');
const alive = (w) => zombies(w).filter((m) => m.alive);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('в начале карта заражена, король далеко от героя', () => {
  const w = createOverworld('her', null);
  assert.equal(alive(w).length, CFG.HORDE.initial);
  assert.ok(w.king && w.king.alive);
  assert.ok(dist(w.king, w.spawn) > 250, 'король далеко от старта');
  for (const z of alive(w)) assert.ok(dist(z, w.hero) >= CFG.HORDE.minDist, 'зомби не появляются рядом с героем');
});

test('орда прибывает, но не больше лимита', () => {
  const w = createOverworld('her', null);
  let max = 0;
  for (let i = 0; i < 60 * 25; i++) {
    updateOverworld(w, EMPTY_INPUT, DT);
    w.events.length = 0;
    max = Math.max(max, alive(w).length);
    hero_safe(w);
  }
  assert.equal(max, CFG.HORDE.cap, 'орда дорастает до лимита и не выше');
});

// Герой в этих тестах стоит на месте: не даём ему погибнуть, чтобы проверять поведение орды.
function hero_safe(w) { w.hero.hp = CFG.HERO.maxHp; w.hero.inv = 1; }

test('зомби идут к герою', () => {
  const w = createOverworld('her', null);
  const z = alive(w)[0];
  const d0 = dist(z, w.hero);
  for (let i = 0; i < 60 * 6; i++) { updateOverworld(w, EMPTY_INPUT, DT); w.events.length = 0; hero_safe(w); }
  assert.ok(dist(z, w.hero) < d0 - 10, 'зомби приблизился');
});

test('зомби касается героя — тот теряет сердце', () => {
  const w = createOverworld('her', null);
  const z = alive(w)[0];
  z.x = z.px = w.hero.x + 4; z.y = z.py = w.hero.y;
  const hp = w.hero.hp;
  steps(w, 5);
  assert.ok(w.hero.hp < hp);
});

test('король убегает от героя и остаётся в пределах карты', () => {
  const w = createOverworld('her', null);
  const k = w.king;
  placeHero(w.hero, k.x - 70, k.y);
  const d0 = dist(k, w.hero);
  for (let i = 0; i < 60 * 3; i++) { updateOverworld(w, EMPTY_INPUT, DT); w.events.length = 0; hero_safe(w); }
  assert.ok(dist(k, w.hero) > d0 + 20, 'расстояние выросло');
  assert.ok(Number.isFinite(k.x) && Number.isFinite(k.y));
  assert.ok(k.x > 0 && k.x < w.map.pxW && k.y > 0 && k.y < w.map.pxH);
  assert.equal(w.map.blockedWalk(toTile(k.x), toTile(k.y)), false, 'король не застрял в стене');
});

test('король стоит, пока герой далеко', () => {
  const w = createOverworld('her', null);
  const x = w.king.x, y = w.king.y;
  for (let i = 0; i < 60 * 2; i++) { updateOverworld(w, EMPTY_INPUT, DT); w.events.length = 0; hero_safe(w); }
  assert.ok(Math.hypot(w.king.x - x, w.king.y - y) < 1);
});

function killKing(w) {
  const k = w.king;
  k.hp = 1;
  spawnProjectile(w.projectiles, 'bulletAk', 'hero', k.x - 6, k.y, CFG.GUN_HEIGHT, 340, 0, 0.5, 3).damage = 1;
}

test('смерть короля: орда рассыпается и больше не появляется', () => {
  const w = createOverworld('her', null);
  placeHero(w.hero, w.king.x - 30, w.king.y);
  killKing(w);
  const seen = steps(w, 5);
  assert.ok(seen.includes('kingDown'), 'событие смерти короля');
  assert.ok(!seen.includes('kill'), 'король — не обычный моб: без заморозки кадра');
  assert.ok(w.kingDead);
  for (let i = 0; i < 60 * 6; i++) { updateOverworld(w, EMPTY_INPUT, DT); w.events.length = 0; hero_safe(w); }
  assert.equal(alive(w).length, 0, 'ни одного зомби');
  for (let i = 0; i < 60 * 8; i++) { updateOverworld(w, EMPTY_INPUT, DT); w.events.length = 0; hero_safe(w); }
  assert.equal(alive(w).length, 0, 'новые не появляются');
  assert.ok(!w.king.alive);
});

test('убитые зомби дают отдельные события и не замораживают кадр', () => {
  const w = createOverworld('her', null);
  const z = alive(w)[0];
  z.x = z.px = w.hero.x + 40; z.y = z.py = w.hero.y; z.hp = 1;
  spawnProjectile(w.projectiles, 'bulletAk', 'hero', z.x - 8, z.y, CFG.GUN_HEIGHT, 340, 0, 0.5, 3).damage = 1;
  const seen = steps(w, 5);
  assert.ok(seen.includes('zkill'));
  assert.ok(!seen.includes('kill'));
});

test('если король уже убит в сохранении — орды нет', () => {
  const w = createOverworld('her', { kingDead: true, hero: 'her' });
  assert.equal(zombies(w).length, 0);
  assert.equal(w.king, null);
  assert.ok(w.kingDead);
});

// ---------- суперудар ----------
const SUPER = { ...EMPTY_INPUT, super: true };

// Убивает зомби пулей: так заряжается суперудар.
function shootZombie(w, z) {
  z.hp = 1;
  spawnProjectile(w.projectiles, 'bulletAk', 'hero', z.x - 8, z.y, CFG.GUN_HEIGHT, 340, 0, 0.5, 3).damage = 1;
}

function chargeUp(w) {
  for (let i = 0; i < CFG.SUPER.kills; i++) {
    const z = alive(w).find((m) => dist(m, w.hero) > 150);
    z.x = z.px = w.hero.x + 60; z.y = z.py = w.hero.y;
    shootZombie(w, z);
    steps(w, 6);
  }
}

test('суперудар заряжается от убийств и без заряда не срабатывает', () => {
  const w = createOverworld('her', null);
  assert.equal(steps(w, 3, SUPER).includes('super'), false, 'без заряда ничего не происходит');
  assert.equal(w.super.charge, 0);
  const z = alive(w)[0];
  z.x = z.px = w.hero.x + 60; z.y = z.py = w.hero.y;
  shootZombie(w, z);
  steps(w, 6);
  assert.equal(w.super.charge, 1);
  chargeUp(w);
  assert.equal(w.super.charge, CFG.SUPER.kills, 'заряд не больше нужного');
});

test('суперудар убивает зомби в радиусе, дальних не трогает, и не заряжает сам себя', () => {
  const w = createOverworld('her', null);
  chargeUp(w);
  const zs = alive(w);
  // Свободные клетки на кольце заданного радиуса вокруг героя (в стены зомби не ставим).
  const ring = (r, n) => {
    const out = [];
    for (let i = 0; i < 72 && out.length < n; i++) {
      const ang = (i / 72) * Math.PI * 2;
      const x = w.hero.x + Math.cos(ang) * r, y = w.hero.y + Math.sin(ang) * r;
      if (!w.map.blockedWalk(toTile(x - 6), toTile(y - 4)) && !w.map.blockedWalk(toTile(x + 6), toTile(y + 4))
        && !w.map.blockedWalk(toTile(x), toTile(y))) out.push([x, y]);
    }
    return out;
  };
  const near = ring(80, 8).map(([x, y], i) => { const z = zs[i]; z.x = z.px = x; z.y = z.py = y; return z; });
  const far = ring(CFG.SUPER.radius + 90, 4).map(([x, y], i) => { const z = zs[8 + i]; z.x = z.px = x; z.y = z.py = y; return z; });
  assert.equal(near.length, 8);
  assert.ok(far.length >= 1);
  w.hero.hp = CFG.HERO.maxHp;
  const seen = steps(w, 1, SUPER);
  assert.ok(seen.includes('super'));
  steps(w, 60);
  assert.ok(near.every((z) => !z.alive), 'все рядом убиты');
  assert.ok(far.some((z) => z.alive), 'дальние живы');
  assert.equal(w.super.charge, 0, 'убийства волной заряд не пополняют');
  assert.equal(w.wave, null, 'волна закончилась');
});

test('суперудар сильно бьёт короля и пугает его', () => {
  const w = createOverworld('her', null);
  chargeUp(w);
  const k = w.king;
  placeHero(w.hero, k.x - 50, k.y);
  const hp = k.hp;
  steps(w, 1, SUPER);
  steps(w, 40);
  assert.equal(k.hp, hp - CFG.SUPER.kingDamage);
  assert.ok(k.alive);
});

test('после трёх убийств приходит событие готовности суперудара', () => {
  const w = createOverworld('her', null);
  const seen = [];
  for (let i = 0; i < CFG.SUPER.kills; i++) {
    const z = alive(w).find((m) => dist(m, w.hero) > 150);
    z.x = z.px = w.hero.x + 60; z.y = z.py = w.hero.y;
    shootZombie(w, z);
    seen.push(...steps(w, 6));
  }
  assert.equal(seen.filter((t) => t === 'superReady').length, 1);
});
