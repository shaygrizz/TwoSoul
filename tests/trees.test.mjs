// Рубка деревьев и смена оружия без браузера. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverworld, updateOverworld } from '../src/core/overworld.js';
import { placeHero, EMPTY_INPUT } from '../src/core/hero.js';
import { CFG } from '../src/config.js';

const DT = CFG.STEP;
const inp = (o) => ({ ...EMPTY_INPUT, ...o });

function steps(w, n, input) {
  for (let i = 0; i < n; i++) { updateOverworld(w, input, DT); w.events.length = 0; }
}

test('у героя АК и топор, переключение по кругу и слотом', () => {
  const w = createOverworld('her', null, { horde: false });
  assert.deepEqual(w.hero.weapons, ['ak', 'axe']);
  assert.equal(w.hero.gun, 'ak');
  steps(w, 1, inp({ switchWeapon: true }));
  assert.equal(w.hero.gun, 'axe');
  steps(w, 1, inp({ slot: 0 }));
  assert.equal(w.hero.gun, 'ak');
});

test('топором дерево рубится, падает, даёт дрова', () => {
  const w = createOverworld('him', null, { horde: false });
  w.mobs.forEach((m) => { m.alive = false; m.respawnT = 1e9; });
  const t = w.trees.find((x) => x.state === 'up');
  assert.ok(t, 'есть дерево для рубки');
  // Встаём слева от дерева, лицом к нему.
  placeHero(w.hero, t.x - 14, t.y - 2);
  steps(w, 1, inp({ slot: 1 }));
  assert.equal(w.hero.gun, 'axe');
  const aim = { x: t.x, y: t.y - 4 };
  for (let i = 0; i < 60 * 4 && t.state === 'up'; i++) { updateOverworld(w, inp({ shoot: true, aim }), DT); w.events.length = 0; }
  assert.notEqual(t.state, 'up', 'дерево срублено');
  steps(w, 60 * 2, inp({}));
  assert.equal(t.state, 'stump');
  const logs = w.pickups.filter((k) => k.active && k.kind === 'wood');
  // Часть поленьев могла уже подлететь к герою, он стоит рядом.
  assert.ok(logs.length + w.wood >= CFG.TREE.logsMin, 'выпали дрова');
  // Подходим к дровам — они подлетают и собираются.
  for (const k of logs) { placeHero(w.hero, k.x, k.y + 4); steps(w, 40, inp({})); }
  assert.ok(w.wood >= CFG.TREE.logsMin, 'дрова собраны: ' + w.wood);
});

test('лесную границу рубить нельзя', () => {
  const w = createOverworld('her', null, { horde: false });
  const border = w.map.objects.filter((o) => o.border);
  assert.ok(border.length > 0);
  assert.ok(w.trees.every((t) => !t.obj.border));
});
