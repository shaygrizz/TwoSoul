// Логика звука без браузера: громкость воды по расстоянию и шаги. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { audio } from '../src/audio.js';
import { createOverworld } from '../src/core/overworld.js';
import { T, toTile } from '../src/core/tilemap.js';
import { CFG } from '../src/config.js';

function waterTile(map) {
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (map.terrainAt(tx, ty) === T.WATER) return { tx, ty };
  }
  return null;
}

test('вода слышна у озера и затихает вдали', () => {
  const w = createOverworld('her', null, { horde: false });
  const t = waterTile(w.map);
  assert.ok(t, 'на карте есть вода');
  const px = (t.tx + 0.5) * CFG.TILE, py = (t.ty + 0.5) * CFG.TILE;
  audio.tickWater(0.2, w.map, px, py, true);
  const near = audio.water.target;
  audio.tickWater(0.2, w.map, 20, 20, true); // левый верхний угол — лес, далеко от озера
  const far = audio.water.target;
  assert.ok(near > 0.5 * CFG.AUDIO.water, 'у воды громко');
  assert.equal(far, 0);
  audio.tickWater(0.2, w.map, px, py, false); // пауза — тишина
  assert.equal(audio.water.target, 0);
});

test('шаги: звук только при ходьбе по земле, не в прыжке', () => {
  const played = [];
  audio.play = (name) => played.push(name);
  const w = createOverworld('her', null, { horde: false });
  const h = w.hero;
  const move = (dx) => { h.px = h.x; h.x += dx; };
  h.vx = 60; h.z = 0;
  for (let i = 0; i < 40; i++) move(1.2); // ~48 px пути
  audio.tickSteps(h, w.map) // один вызов считает один шаг пути
  played.length = 0;
  for (let i = 0; i < 40; i++) { move(1.2); audio.tickSteps(h, w.map); }
  assert.ok(played.length >= 1 && played.every((n) => n.startsWith('step')), 'шаги есть');
  const count = played.length;
  h.z = 5;
  for (let i = 0; i < 40; i++) { move(1.2); audio.tickSteps(h, w.map); }
  assert.equal(played.length, count, 'в прыжке шагов нет');
  assert.ok(Number.isInteger(toTile(h.x)));
});
