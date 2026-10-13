// Тайловая карта: рельеф, проходимость, объекты и метки (спавны, плиты, двери).
import { CFG } from '../config.js';
import { hash2 } from './rng.js';

export const T = {
  GRASS: 0, PATH: 1, WATER: 2, FLOOR: 3, WALL: 4, LAVA: 5, POOL: 6, ACID: 7,
};

const WALK_SOLID = new Set([T.WATER, T.WALL]);
const SHOT_SOLID = new Set([T.WALL]);

// Объекты: какие клетки они занимают (относительно якоря) и останавливают ли снаряды.
const OBJECT_DEFS = {
  tree:   { tiles: [[0, 0]], shot: true },
  pine:   { tiles: [[0, 0]], shot: true },
  bush:   { tiles: [[0, 0]], shot: false },
  rock:   { tiles: [[0, 0]], shot: true },
  fence:  { tiles: [[0, 0]], shot: false },
  sign:   { tiles: [[0, 0]], shot: false },
  house:  { tiles: rectTiles(-1, -2, 6, 0), shot: true },
  gate:   { tiles: [[-1, 0], [1, 0]], shot: true },
  flowers: { tiles: [], shot: false },
};

function rectTiles(x0, y0, x1, y1) {
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

// Легенда символов: рельеф + необязательный объект или метка.
export const OVERWORLD_LEGEND = {
  '.': { t: T.GRASS },
  'x': { t: T.GRASS, obj: 'flowers' },
  '=': { t: T.PATH },
  '~': { t: T.WATER },
  '#': { t: T.GRASS, obj: 'forest' },
  'T': { t: T.GRASS, obj: 'tree' },
  'P': { t: T.GRASS, obj: 'pine' },
  'b': { t: T.GRASS, obj: 'bush' },
  'o': { t: T.GRASS, obj: 'rock' },
  'f': { t: T.GRASS, obj: 'fence' },
  'n': { t: T.GRASS, obj: 'sign' },
  'H': { t: T.GRASS, obj: 'house' },
  'G': { t: T.PATH, obj: 'gate', mark: 'gate' },
  'S': { t: T.PATH, mark: 'spawn' },
  's': { t: T.GRASS, mark: 'slime' },
  'v': { t: T.GRASS, mark: 'bat' },
  'm': { t: T.GRASS, mark: 'mushroom' },
};

export const TRIAL_LEGEND = {
  '.': { t: T.FLOOR },
  '#': { t: T.WALL },
  'L': { t: T.LAVA },
  'W': { t: T.POOL },
  'A': { t: T.ACID },
  '1': { t: T.FLOOR, mark: 'plate1' },
  '2': { t: T.FLOOR, mark: 'plate2' },
  'a': { t: T.FLOOR, mark: 'door1' },
  'b': { t: T.FLOOR, mark: 'door2' },
  'F': { t: T.FLOOR, mark: 'exitFire' },
  'O': { t: T.FLOOR, mark: 'exitWater' },
  'f': { t: T.FLOOR, mark: 'startFire' },
  'w': { t: T.FLOOR, mark: 'startWater' },
};

export class TileMap {
  constructor(rows, legend) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('Пустая карта');
    this.source = rows; // исходные строки (ключ для кэша отрисовки)
    this.h = rows.length;
    this.w = rows[0].length;
    const n = this.w * this.h;
    this.terrain = new Uint8Array(n);
    this.walkBlock = new Uint8Array(n);
    this.shotBlock = new Uint8Array(n);
    this.objects = [];
    this.marks = {};
    this.pxW = this.w * CFG.TILE;
    this.pxH = this.h * CFG.TILE;

    for (let ty = 0; ty < this.h; ty++) {
      const row = rows[ty];
      if (row.length !== this.w) throw new Error(`Строка ${ty} карты другой длины`);
      for (let tx = 0; tx < this.w; tx++) {
        const def = legend[row[tx]];
        if (!def) throw new Error(`Неизвестный символ «${row[tx]}» в (${tx},${ty})`);
        const i = ty * this.w + tx;
        this.terrain[i] = def.t;
        if (WALK_SOLID.has(def.t)) this.walkBlock[i] = 1;
        if (SHOT_SOLID.has(def.t)) this.shotBlock[i] = 1;
        if (def.mark) (this.marks[def.mark] ||= []).push({ tx, ty });
        if (def.obj) this.addObject(def.obj, tx, ty);
      }
    }
  }

  addObject(type, tx, ty) {
    let kind = type;
    if (type === 'forest') kind = hash2(tx, ty, 11) < 0.35 ? 'pine' : 'tree';
    const def = OBJECT_DEFS[kind];
    // border — лесная граница карты: её нельзя рубить.
    const obj = { type: kind, tx, ty, variant: Math.floor(hash2(tx, ty, 5) * 4), border: type === 'forest' };
    this.objects.push(obj);
    for (const [dx, dy] of def.tiles) {
      const x = tx + dx, y = ty + dy;
      if (!this.inside(x, y)) continue;
      const i = y * this.w + x;
      this.walkBlock[i] = 1;
      if (def.shot) this.shotBlock[i] = 1;
    }
  }

  inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  terrainAt(tx, ty) {
    if (!this.inside(tx, ty)) return -1;
    return this.terrain[ty * this.w + tx];
  }

  // За пределами карты всегда стена.
  blockedWalk(tx, ty) { return !this.inside(tx, ty) || this.walkBlock[ty * this.w + tx] === 1; }
  blockedShot(tx, ty) { return !this.inside(tx, ty) || this.shotBlock[ty * this.w + tx] === 1; }

  mark(name) {
    const list = this.marks[name];
    return list && list.length > 0 ? list[0] : null;
  }
}

export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * CFG.TILE, y: (ty + 0.5) * CFG.TILE };
}

export function toTile(px) { return Math.floor(px / CFG.TILE); }
