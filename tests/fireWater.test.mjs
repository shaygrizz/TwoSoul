// Проверка испытания без браузера: проходимость, опасности, двери.
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { fireWater } from '../src/trials/fireWater.js';
import { EMPTY_INPUT } from '../src/core/hero.js';
import { CFG } from '../src/config.js';

const DT = CFG.STEP;
const TILE = CFG.TILE;

function inputs(s, idx, inp) {
  return s.heroes.map((_, i) => (i === idx ? inp : EMPTY_INPUT));
}

// Ведёт героя к центру клетки (tx, ty). jumpAtY — прыгнуть, когда y меньше этого значения.
function walk(s, idx, tx, ty, { jumpAtY = null, maxT = 12 } = {}) {
  const h = s.heroes[idx];
  const gx = (tx + 0.5) * TILE, gy = (ty + 0.5) * TILE;
  let jumped = false;
  for (let t = 0; t < maxT; t += DT) {
    const dx = gx - h.x, dy = gy - h.y;
    const d = Math.hypot(dx, dy);
    if ((d < 1.5 && h.z === 0) || s.won) return true;
    const k = d > 6 ? 1 : d / 6;
    let jump = false;
    if (jumpAtY !== null && !jumped && h.y < jumpAtY && h.z === 0) { jump = true; jumped = true; }
    fireWater.update(s, inputs(s, idx, { mx: (dx / d) * k, my: (dy / d) * k, jump, shoot: false, dash: false, aim: null }), DT);
    if (h.dead) return false;
  }
  return false;
}

function idle(s, sec) {
  for (let t = 0; t < sec; t += DT) fireWater.update(s, s.heroes.map(() => EMPTY_INPUT), DT);
}

test('карта и герои создаются', () => {
  const s = fireWater.start({ playerKind: 'her' });
  assert.equal(s.heroes.length, 2);
  assert.equal(s.heroes[0].element, 'fire');
  assert.equal(s.heroes[1].element, 'water');
  assert.equal(s.heroes[s.active].kind, 'her');
  assert.equal(s.doors[0].tiles.length, 2);
  assert.equal(s.doors[1].tiles.length, 1);
});

test('испытание проходится вдвоём', () => {
  const s = fireWater.start({ playerKind: 'him' });
  const F = 0, W = 1;
  assert.ok(walk(s, F, 4, 14), 'огонь идёт через лаву');
  assert.ok(walk(s, F, 2, 13), 'огонь встаёт на плиту 1');
  assert.ok(s.doors[0].isOpen, 'дверь 1 открыта');
  assert.ok(walk(s, W, 11, 11), 'вода к двери 1');
  assert.ok(walk(s, W, 11, 8), 'вода проходит дверь 1 и встаёт на плиту 2');
  assert.ok(s.doors[1].isOpen, 'дверь 2 открыта');
  assert.ok(walk(s, F, 2, 11) && walk(s, F, 2, 8), 'огонь проходит дверь 2');
  assert.ok(walk(s, W, 11, 7), 'вода сходит с плиты');
  idle(s, 0.5);
  assert.ok(!s.doors[1].isOpen, 'дверь 2 закрылась');
  assert.ok(walk(s, W, 11, 4, { jumpAtY: 7 * TILE + 7 }), 'вода перепрыгивает кислоту');
  assert.ok(walk(s, W, 20, 5) && walk(s, W, 22, 1), 'вода идёт по воде к выходу');
  assert.ok(walk(s, F, 5, 7), 'огонь к кислоте');
  assert.ok(walk(s, F, 5, 4, { jumpAtY: 7 * TILE + 7 }), 'огонь перепрыгивает кислоту');
  assert.ok(walk(s, F, 1, 1), 'огонь идёт по лаве к выходу');
  assert.ok(s.won, 'победа засчитана');
  idle(s, 3);
  assert.ok(s.done);
  const r = fireWater.finish(s);
  assert.ok(r.gems >= 1 && r.totalGems === 8);
});

test('вода в лаве погибает и возрождается на старте', () => {
  const s = fireWater.start({ playerKind: 'her' });
  const w = s.heroes[1];
  assert.equal(walk(s, 1, 6, 14, { maxT: 4 }), false);
  assert.ok(s.events.some((e) => e.type === 'trialDeath' && e.element === 'water'));
  idle(s, 1.2);
  assert.ok(!w.dead);
  assert.equal(Math.round(w.x), Math.round(w.startX));
});

test('без плиты дверь 1 не пускает', () => {
  const s = fireWater.start({ playerKind: 'her' });
  walk(s, 1, 11, 8, { maxT: 4 });
  assert.ok(s.heroes[1].y > 10 * TILE, 'вода осталась внизу');
});

test('кислоту нельзя перейти пешком', () => {
  const s = fireWater.start({ playerKind: 'him' });
  walk(s, 0, 4, 14); walk(s, 0, 2, 13);
  walk(s, 1, 11, 11); walk(s, 1, 11, 8);
  assert.equal(walk(s, 1, 11, 4, { maxT: 4 }), false);
  assert.ok(s.events.some((e) => e.type === 'trialDeath' && e.element === 'water'));
});
