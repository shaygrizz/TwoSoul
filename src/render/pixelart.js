// Процедурная пиксельная графика: земля карты (с анимацией жидкостей) и атлас объектов.
// Всё рисуется один раз при загрузке, в игровом цикле ничего не создаётся.
import { CFG } from '../config.js';
import { T } from '../core/tilemap.js';
import { hash2, noise2 } from '../core/rng.js';

export const LIQUID_FRAMES = 4;

const P = {
  grassDeep: '#2c6a2e', grassDark: '#37803a', grass: '#43943f', grassLight: '#55a84a', grassHi: '#76c25e', grassEdge: '#255c29',
  path: '#a0714a', pathLight: '#b5875c', pathDark: '#8a5f3d', pathRim: '#6c4730', pebble: '#c49a6c',
  bank: '#7a5236', bankDark: '#583a25',
  water: '#3b7fd0', waterDeep: '#336fbf', waterShallow: '#5c9fe4', waterHi: '#9ccff6', foam: '#e3f4ff',
  stone: '#8f8a7b', stoneLight: '#a39e8d', stoneDark: '#787365', mortar: '#57534a', moss: '#5f8d3b', mossLight: '#79a94a',
  wallTop: '#b3ad98', wallTopLight: '#c8c2ac', wallTopDark: '#958f7c', wallFace: '#76705f', wallFaceDark: '#5a5548', wallShadow: '#3f3c34',
  lava: '#e8641f', lavaHot: '#ff9a2e', lavaCore: '#ffd451', lavaCrust: '#9c2a14',
  acid: '#5fb532', acidLight: '#93e055', acidDark: '#3f8a22', acidBubble: '#d4ff9a',
  rim: '#2f2c27',
};

// ---------- утилиты цвета ----------
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const RGB = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, rgb(v)]));
const RGB_CACHE = new Map();
function cacheRgb(hex) { const c = rgb(hex); RGB_CACHE.set(hex, c); return c; }

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---------- земля ----------
// Кадры земли кэшируются по исходной карте: повторный вход на карту не перерисовывает её.
const groundCache = new WeakMap();

// Возвращает массив canvas-кадров (жидкости анимированы, остальное одинаково).
export function paintGround(map, style) {
  const key = map.source;
  const hit = key && groundCache.get(key);
  if (hit) return hit;
  const frames = paintGroundUncached(map, style);
  if (key) groundCache.set(key, frames);
  return frames;
}

function paintGroundUncached(map, style) {
  const W = map.pxW, H = map.pxH, TILE = CFG.TILE;
  const soft = style === 'overworld';
  const terr = new Int8Array(W * H);

  // Рельеф по пикселям. На природе границы «рваные» за счёт шума.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx = x, sy = y;
      if (soft) {
        sx = x + (noise2(x * 0.17, y * 0.17, 3) - 0.5) * 8;
        sy = y + (noise2(x * 0.17 + 40, y * 0.17, 4) - 0.5) * 8;
      }
      let t = map.terrainAt(Math.floor(sx / TILE), Math.floor(sy / TILE));
      if (t < 0) t = map.terrainAt(Math.min(map.w - 1, Math.max(0, Math.floor(x / TILE))), Math.min(map.h - 1, Math.max(0, Math.floor(y / TILE))));
      terr[y * W + x] = t;
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : terr[y * W + x]);

  const base = new Uint8ClampedArray(W * H * 4);
  const liquid = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = terr[y * W + x];
      let c;
      if (t === T.GRASS) c = grassColor(x, y, at);
      else if (t === T.PATH) c = pathColor(x, y, at);
      else if (t === T.FLOOR) c = floorColor(x, y, map);
      else if (t === T.WALL) c = wallColor(x, y, map);
      else { c = RGB.water; liquid.push(y * W + x); }
      const i = (y * W + x) * 4;
      base[i] = c[0]; base[i + 1] = c[1]; base[i + 2] = c[2]; base[i + 3] = 255;
    }
  }

  // Декор пишем прямо в буфер: вызовы canvas на каждый пиксель слишком медленные.
  const dot = (x, y, hex) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const c = RGB_CACHE.get(hex) || cacheRgb(hex);
    const i = (y * W + x) * 4;
    base[i] = c[0]; base[i + 1] = c[1]; base[i + 2] = c[2];
  };
  if (soft) paintGrassDecor(dot, map, at);
  else paintFloorDecor(dot, map);
  const decorated = base;

  const frames = [];
  for (let f = 0; f < LIQUID_FRAMES; f++) {
    const data = new Uint8ClampedArray(decorated);
    const ang = (f / LIQUID_FRAMES) * Math.PI * 2;
    const ox = Math.cos(ang) * 3, oy = Math.sin(ang) * 3;
    for (const p of liquid) {
      const x = p % W, y = (p / W) | 0;
      const t = terr[p];
      let c;
      if (t === T.LAVA) c = lavaColor(x, y, at, ox, oy, f);
      else if (t === T.ACID) c = acidColor(x, y, at, ox, oy, f);
      else c = waterColor(x, y, at, ox, oy, f, t);
      const i = p * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
    }
    const cv = makeCanvas(W, H);
    cv.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
    frames.push(cv);
  }
  return frames;
}

function grassColor(x, y, at) {
  // Тёмная кромка травы у тропинки и у воды.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = at(x + dx, y + dy);
    if (n === T.PATH || n === T.WATER) return RGB.grassEdge;
  }
  const big = noise2(x / 38, y / 38, 21);
  const n = noise2(x / 5, y / 5, 1) + (big - 0.5) * 0.5;
  const h = hash2(x, y, 2);
  if (h > 0.992) return RGB.grassHi;
  if (n < 0.28) return RGB.grassDark;
  if (n < 0.62) return RGB.grass;
  return RGB.grassLight;
}

function pathColor(x, y, at) {
  // Тень под травяным бортиком сверху и тёмный обод по краям.
  if (at(x, y - 1) === T.GRASS || at(x, y - 2) === T.GRASS) return RGB.pathRim;
  if (at(x - 1, y) === T.GRASS || at(x + 1, y) === T.GRASS || at(x, y + 1) === T.GRASS) return RGB.pathDark;
  const n = noise2(x / 4, y / 4, 7);
  const h = hash2(x, y, 8);
  if (h > 0.985) return RGB.pebble;
  if (h < 0.012) return RGB.pathRim;
  if (n < 0.3) return RGB.pathDark;
  if (n > 0.7) return RGB.pathLight;
  return RGB.path;
}

function floorColor(x, y, map) {
  const TILE = CFG.TILE;
  const lx = x % TILE, ly = y % TILE;
  const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
  // Тень от стены сверху.
  if (map.terrainAt(tx, ty - 1) === T.WALL && ly < 3) return ly === 0 ? RGB.wallShadow : RGB.stoneDark;
  if (lx === 15 || ly === 15) return RGB.mortar;
  const moss = noise2(x / 22, y / 22, 31);
  const n = noise2(x / 3, y / 3, 32);
  const h = hash2(x, y, 33);
  const slab = hash2(tx, ty, 34);
  if (moss > 0.68 && h > 0.35) return h > 0.8 ? RGB.mossLight : RGB.moss;
  if (lx === 0 || ly === 0) return RGB.stoneLight;
  if (h > 0.985) return RGB.stoneDark;
  if (n + (slab - 0.5) * 0.3 < 0.35) return RGB.stoneDark;
  if (n > 0.72) return RGB.stoneLight;
  return RGB.stone;
}

function wallColor(x, y, map) {
  const TILE = CFG.TILE;
  const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
  const lx = x % TILE, ly = y % TILE;
  const below = map.terrainAt(tx, ty + 1);
  const above = map.terrainAt(tx, ty - 1);
  const faceStart = 6;
  const hasFace = below !== T.WALL && below !== -1;
  if (!hasFace || ly < faceStart) {
    // Верх стены.
    if (above !== T.WALL && above !== -1 && ly === 0) return RGB.wallTopLight;
    // Плиты на верху стены.
    if ((lx + (ty % 2) * 8) % 16 === 15 || (hasFace && ly === faceStart - 1)) return RGB.wallTopDark;
    const n = noise2(x / 4, y / 4, 41);
    if (hash2(x, y, 42) > 0.97) return RGB.moss;
    return n > 0.6 ? RGB.wallTopLight : RGB.wallTop;
  }
  // Передняя грань с кладкой.
  const fy = ly - faceStart;
  if (fy === 0) return RGB.wallShadow;
  if (ly === 15) return RGB.wallShadow;
  const row = (fy - 1) >> 2;
  const off = row % 2 === 0 ? 0 : 4;
  if ((fy - 1) % 4 === 3 || (lx + off) % 8 === 0) return RGB.wallFaceDark;
  if (hash2(x, y, 43) > 0.93) return RGB.moss;
  return RGB.wallFace;
}

function nearNot(x, y, at, t, r) {
  for (let d = 1; d <= r; d++) {
    if (at(x - d, y) !== t || at(x + d, y) !== t || at(x, y + d) !== t) return true;
  }
  return false;
}

function bankDepth(x, y, at, t) {
  for (let k = 1; k <= 4; k++) if (at(x, y - k) !== t) return k;
  return 0;
}

function waterColor(x, y, at, ox, oy, f, t) {
  const k = bankDepth(x, y, at, t);
  if (k === 1) return t === T.WATER ? RGB.grassEdge : RGB.rim;
  if (k === 2 || k === 3) return t === T.WATER ? RGB.bank : RGB.wallFaceDark;
  if (k === 4) return t === T.WATER ? RGB.bankDark : RGB.wallShadow;
  if (nearNot(x, y, at, t, 1)) return RGB.foam;
  const shallow = nearNot(x, y, at, t, 3);
  const n = noise2((x + ox * 2) / 9, (y + oy) / 2.2, 9);
  if (hash2(x, y, 100 + f) > 0.996) return RGB.foam;
  if (n > 0.76) return RGB.waterHi;
  if (shallow) return RGB.waterShallow;
  return noise2(x / 14, y / 10, 12) < 0.4 ? RGB.waterDeep : RGB.water;
}

function lavaColor(x, y, at, ox, oy, f) {
  const k = bankDepth(x, y, at, T.LAVA);
  if (k === 1) return RGB.rim;
  if (k === 2) return RGB.lavaCrust;
  if (nearNot(x, y, at, T.LAVA, 1)) return RGB.lavaCrust;
  const n = noise2((x + ox * 2) / 6, (y + oy * 2) / 6, 51);
  const m = noise2(x / 13 - ox / 4, y / 13 + oy / 4, 52);
  if (hash2(x, y, 200 + f) > 0.994) return RGB.lavaCore;
  if (m < 0.22) return RGB.lavaCrust;
  if (n > 0.72) return RGB.lavaCore;
  if (n > 0.48) return RGB.lavaHot;
  return RGB.lava;
}

function acidColor(x, y, at, ox, oy, f) {
  const k = bankDepth(x, y, at, T.ACID);
  if (k === 1) return RGB.rim;
  if (k === 2) return RGB.acidDark;
  if (nearNot(x, y, at, T.ACID, 1)) return RGB.acidDark;
  // Пузырьки: в каждой ячейке 6x6 свой пузырь, растущий по кадрам.
  const cx = Math.floor(x / 6), cy = Math.floor(y / 6);
  const phase = Math.floor(hash2(cx, cy, 61) * LIQUID_FRAMES);
  const r = ((f + phase) % LIQUID_FRAMES) * 0.7;
  const bx = cx * 6 + 3, by = cy * 6 + 3;
  const d = Math.hypot(x - bx, y - by);
  if (hash2(cx, cy, 62) > 0.55 && r > 0.5 && Math.abs(d - r) < 0.6) return RGB.acidBubble;
  const n = noise2((x + ox * 2) / 7, (y + oy) / 3, 63);
  if (n > 0.7) return RGB.acidLight;
  return RGB.acid;
}

// Пучки травы и цветы поверх земли.
function paintGrassDecor(dot, map, at) {
  const W = map.pxW, H = map.pxH;
  const flowerTiles = new Set(map.objects.filter((o) => o.type === 'flowers').map((o) => o.ty * map.w + o.tx));
  const petals = ['#ffffff', '#ffd5e5', '#ff9ec4', '#bfe3ff', '#ffe680', '#d9b8ff'];
  for (let cy = 0; cy < H; cy += 7) {
    for (let cx = 0; cx < W; cx += 7) {
      const h = hash2(cx, cy, 71);
      const x = cx + Math.floor(hash2(cx, cy, 72) * 5), y = cy + Math.floor(hash2(cx, cy, 73) * 5);
      if (at(x, y) !== T.GRASS || at(x + 2, y + 2) !== T.GRASS || at(x, y - 3) !== T.GRASS) continue;
      const tIdx = Math.floor(y / CFG.TILE) * map.w + Math.floor(x / CFG.TILE);
      const flowerChance = flowerTiles.has(tIdx) ? 0.55 : 0.05;
      if (h < flowerChance) {
        const pc = petals[Math.floor(hash2(cx, cy, 74) * petals.length)];
        dot(x, y + 1, '#2a6b2c');
        dot(x - 1, y - 1, pc); dot(x + 1, y - 1, pc); dot(x, y - 2, pc); dot(x, y, pc);
        dot(x, y - 1, '#ffd84a');
      } else if (h < 0.55) {
        dot(x, y, P.grassHi); dot(x + 2, y, P.grassHi); dot(x + 1, y - 1, P.grassHi);
        dot(x, y + 1, P.grassDeep); dot(x + 1, y + 1, P.grassDeep); dot(x + 2, y + 1, P.grassDeep);
      }
    }
  }
}

function paintFloorDecor(dot, map) {
  const TILE = CFG.TILE;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (map.terrainAt(tx, ty) !== T.FLOOR) continue;
      const h = hash2(tx, ty, 81);
      const x = tx * TILE, y = ty * TILE;
      if (h < 0.18) { // трещина
        let cx = x + 3 + Math.floor(hash2(tx, ty, 82) * 8), cy = y + 3 + Math.floor(hash2(tx, ty, 83) * 6);
        for (let i = 0; i < 5; i++) { dot(cx, cy, P.mortar); cx += 1; cy += hash2(tx + i, ty, 84) > 0.5 ? 1 : 0; }
      } else if (h > 0.86) { // травинки в щелях
        dot(x + 15, y + 12, P.grassLight); dot(x + 14, y + 14, P.grass); dot(x + 12, y + 15, P.grassLight);
      }
    }
  }
}

function dot(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }

// ---------- спрайты ----------
class Spr {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.canvas = makeCanvas(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.filled = new Uint8Array(w * h);
  }
  px(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, 1, 1);
    this.filled[y * this.w + x] = 1;
  }
  has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.filled[y * this.w + x] === 1; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); }
  // Эллипс с объёмной заливкой (свет слева сверху).
  blob(cx, cy, rx, ry, pal, outline = true) {
    const [out, dark, mid, light, hi] = pal;
    if (outline) this.ellipse(cx, cy, rx + 1, ry + 1, () => out);
    this.ellipse(cx, cy, rx, ry, (dx, dy, x, y) => {
      let s = -(dx / rx * 0.55 + dy / ry * 0.83);
      s += ((x + y) & 1) ? 0.07 : -0.07;
      return s > 0.6 ? hi : s > 0.12 ? light : s > -0.42 ? mid : dark;
    });
  }
  ellipse(cx, cy, rx, ry, colFn) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) this.px(x, y, colFn(dx, dy, x, y));
      }
    }
  }
  // Обводка по пустым пикселям вокруг заполненных.
  outline(c) {
    const pts = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.has(x, y)) continue;
        if (this.has(x + 1, y) || this.has(x - 1, y) || this.has(x, y + 1) || this.has(x, y - 1)) pts.push(x, y);
      }
    }
    for (let i = 0; i < pts.length; i += 2) this.px(pts[i], pts[i + 1], c);
  }
  // Рисунок из строк: каждый символ — цвет из словаря, '.' — пусто.
  bitmap(x0, y0, rows, colors) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = colors[row[x]];
        if (c) this.px(x0 + x, y0 + y, c);
      }
    });
  }
}

const LEAF2 = ['#1d4721', '#2d6d2b', '#3f8f37', '#5bb04a', '#88d063'];
const ROCK = ['#3d4048', '#666b75', '#878c96', '#a7acb5', '#c8ccd3'];
const SLIME = ['#1f4d3a', '#3c8f5e', '#5cc27a', '#8be39b', '#d7ffe0'];
const BAT = ['#2a1838', '#4a2c63', '#6b4590', '#8d63b5', '#b48ad8'];
const CAP = ['#5a1a1a', '#a32d2d', '#d4423a', '#ee6a55', '#ffb3a0'];

function paintBush(v) {
  const s = new Spr(24, 19);
  s.blob(12, 8, 6, 5, LEAF2); s.blob(7, 11, 5, 4, LEAF2); s.blob(17, 11, 5, 4, LEAF2); s.blob(12, 12, 6, 4, LEAF2);
  if (v % 2 === 1) {
    const berry = v === 1 ? '#ff5d7a' : '#ffd1e8';
    for (const [x, y] of [[8, 9], [14, 7], [17, 12], [11, 13], [6, 13]]) { s.px(x, y, berry); s.px(x, y - 1, '#ffffff'); }
  }
  s.outline(LEAF2[0]);
  return { s, ax: 12, ay: 16 };
}

function paintRock(v) {
  const s = new Spr(20, 15);
  s.blob(10, 8, 6, 5, ROCK); s.blob(5, 10, 4, 3, ROCK); s.blob(14, 10, 4, 3, ROCK);
  if (v % 2 === 0) for (const [x, y] of [[8, 3], [9, 3], [10, 4], [11, 3]]) s.px(x, y, '#5f8d3b');
  s.outline(ROCK[0]);
  return { s, ax: 10, ay: 13 };
}

function paintFence() {
  const s = new Spr(16, 16);
  const wood = ['#4e301b', '#8a5a33', '#a8743f'];
  for (const x of [1, 12]) { s.rect(x, 2, 3, 13, wood[1]); s.rect(x, 2, 1, 13, wood[2]); s.px(x + 1, 1, wood[1]); }
  s.rect(0, 5, 16, 2, wood[2]); s.rect(0, 10, 16, 2, wood[1]);
  s.outline(wood[0]);
  return { s, ax: 8, ay: 14 };
}

function paintSign() {
  const s = new Spr(20, 24);
  s.rect(9, 12, 2, 11, '#6b4426');
  s.rect(2, 3, 16, 10, '#b5875c'); s.rect(2, 3, 16, 1, '#d4a676'); s.rect(2, 12, 16, 1, '#7a5236');
  s.rect(5, 6, 9, 1, '#5a3a24'); s.rect(5, 9, 6, 1, '#5a3a24');
  s.px(14, 9, '#ff6a3a'); s.px(15, 9, '#4aa3ff');
  s.outline('#3d2616');
  return { s, ax: 10, ay: 22 };
}

function paintGate() {
  const s = new Spr(62, 72);
  // Портал: огонь слева, вода справа, закрученный.
  const cx = 31, cy = 44;
  for (let y = 18; y < 69; y++) {
    for (let x = 18; x < 44; x++) {
      const dx = x - cx, dy = (y - cy) * 0.6;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const v = Math.sin(a * 2 + r * 0.45);
      const fire = dx + Math.sin(dy * 0.3) * 3 < 0;
      const pal = fire ? ['#9c2a14', '#e8641f', '#ff9a2e', '#ffd451'] : ['#1f4d9a', '#3b7fd0', '#5c9fe4', '#bfe6ff'];
      const k = v > 0.55 ? 3 : v > 0.05 ? 2 : v > -0.5 ? 1 : 0;
      s.px(x, y, r < 3 ? '#ffffff' : pal[k]);
    }
  }
  // Колонны.
  for (const px0 of [4, 44]) {
    for (let y = 14; y < 69; y++) {
      const row = Math.floor((y - 14) / 7), ly = (y - 14) % 7, off = row % 2 ? 4 : 0;
      for (let x = px0; x < px0 + 14; x++) {
        const lx = (x - px0 + off) % 7;
        let c = x - px0 < 3 ? '#b8b3a3' : x - px0 > 10 ? '#7a7566' : '#9a9584';
        if (ly === 6 || lx === 6) c = '#5d594e';
        if (hash2(x, y, 97) > 0.92) c = '#5f8d3b';
        s.px(x, y, c);
      }
    }
  }
  // Арка и замковый камень.
  for (let x = 2; x < 60; x++) {
    const t = (x - 31) / 29;
    const top = Math.round(5 + t * t * 9);
    for (let y = top; y < top + 12; y++) {
      if (y >= 18 && x >= 18 && x < 44 && y > top + 9) continue;
      s.px(x, y, y === top ? '#c8c2ac' : y > top + 9 ? '#5d594e' : (x + y) % 9 === 0 ? '#5d594e' : '#9a9584');
    }
  }
  s.rect(26, 2, 10, 12, '#b3ad98'); s.rect(26, 2, 10, 1, '#d4cfbc');
  s.rect(28, 5, 3, 5, '#ff9a2e'); s.rect(31, 5, 3, 5, '#5c9fe4');
  // Ступень.
  s.rect(2, 68, 58, 3, '#8f8a7b'); s.rect(2, 68, 58, 1, '#b3ad98');
  s.outline('#2f2c27');
  return { s, ax: 31, ay: 70 };
}

// Слайм: форма задаётся полуосями, низ всегда на одной линии. Светящееся ядро — как в пещерном стиле.
function paintSlime(rx, ry, blink = false) {
  const s = new Spr(20, 17);
  const bottom = 15.5, cx = 10, cy = bottom - ry;
  s.blob(cx, cy, rx, ry, SLIME);
  // Ядро светится изнутри.
  s.ellipse(cx + 0.5, cy + ry * 0.35, Math.max(1.2, rx * 0.35), Math.max(1, ry * 0.3), () => '#b9ffd0');
  s.px(cx + 0.5, cy + ry * 0.35, '#ffffff');
  // Блик.
  s.px(cx - rx * 0.55, cy - ry * 0.55, '#ffffff'); s.px(cx - rx * 0.55 + 1, cy - ry * 0.55, '#ffffff'); s.px(cx - rx * 0.55, cy - ry * 0.55 + 1, '#ffffff');
  const ey = Math.round(cy - ry * 0.05);
  if (blink) { s.rect(cx - 4, ey + 1, 2, 1, '#18301f'); s.rect(cx + 2, ey + 1, 2, 1, '#18301f'); }
  else { s.rect(cx - 3, ey, 1, 2, '#18301f'); s.rect(cx + 2, ey, 1, 2, '#18301f'); s.px(cx - 3, ey, '#e8fff0'); s.px(cx + 2, ey, '#e8fff0'); }
  s.px(cx - 4, ey + 2, '#ff9eb5'); s.px(cx + 3, ey + 2, '#ff9eb5');
  return { s, ax: 10, ay: 16 };
}

// Летучая мышь: L — подъём крыльев (вверх > 0, вниз < 0). Глаза светятся.
function paintBat(L) {
  const s = new Spr(26, 18);
  for (const dir of [1, -1]) {
    for (let i = 0; i <= 9; i++) {
      const t = i / 9;
      const top = Math.round(9 - t * L);
      let bot = Math.round(11 - t * L * 0.5 + t * 1.5);
      if (i % 3 === 2) bot -= 1;
      const x = dir > 0 ? 16 + i : 9 - i;
      for (let y = Math.min(top, bot); y <= Math.max(top, bot); y++) s.px(x, y, y === Math.min(top, bot) ? BAT[3] : BAT[2]);
    }
  }
  s.blob(13, 10, 4, 4, BAT);
  s.px(10, 5, BAT[2]); s.px(11, 6, BAT[2]); s.px(15, 5, BAT[2]); s.px(14, 6, BAT[2]);
  s.px(11, 9, '#ffffff'); s.px(14, 9, '#ffffff'); s.px(11, 10, '#ff5fc8'); s.px(14, 10, '#ff5fc8');
  s.px(12, 12, '#ffffff'); s.px(13, 12, '#ffffff');
  s.outline(BAT[0]);
  return { s, ax: 13, ay: 11 };
}

// Гриб: dy — насколько шляпка опущена, wide — расплющенность; пятна светятся.
function paintMushroom(dy, wide = 0, blink = false) {
  const s = new Spr(22, 24);
  const capY = 12 + dy;
  const rx = 8.5 + wide, ry = 8 - wide * 0.8;
  for (let y = capY; y < 22; y++) for (let x = 8; x < 14; x++) s.px(x, y, x === 8 ? '#fff6e0' : x === 13 ? '#d9c39c' : '#f3e2c4');
  const fy = 16 + Math.max(0, dy - 1);
  if (blink) { s.rect(9, fy + 1, 1, 1, '#3a2216'); s.rect(12, fy + 1, 1, 1, '#3a2216'); }
  else { s.rect(9, fy, 1, 2, '#3a2216'); s.rect(12, fy, 1, 2, '#3a2216'); }
  s.px(8, fy + 2, '#ff9eb5'); s.px(13, fy + 2, '#ff9eb5');
  for (let y = Math.floor(capY - ry); y <= capY; y++) {
    for (let x = 0; x < 22; x++) {
      const dx = x + 0.5 - 11, dyy = y + 0.5 - capY;
      if ((dx * dx) / (rx * rx) + (dyy * dyy) / (ry * ry) > 1) continue;
      const v = -(dx / rx * 0.5 + dyy / ry * 0.85) + (((x + y) & 1) ? 0.06 : -0.06);
      s.px(x, y, y === capY ? '#e6c9a5' : v > 0.95 ? CAP[4] : v > 0.55 ? CAP[3] : v > 0.2 ? CAP[2] : CAP[1]);
    }
  }
  for (const [x, y, r] of [[7, capY - 4, 1.4], [13, capY - 6, 1.7], [16, capY - 2, 1.1], [10, capY - 2, 1]]) {
    s.ellipse(x, y, r + 0.6, r + 0.6, () => '#9ff7ff');
    s.ellipse(x, y, r, r, () => '#ffffff');
  }
  s.outline(CAP[0]);
  return { s, ax: 11, ay: 22 };
}

const HEART_ROWS = [
  '.##.##.',
  '#hh#oo#',
  '#hoooo#',
  '#ooood#',
  '.#ood#.',
  '..#d#..',
  '...#...',
];

function paintHeart(empty) {
  const s = new Spr(7, 7);
  const col = empty
    ? { '#': '#3a1a2a', h: '#6a4a5a', o: '#4a2a3a', d: '#3f2030' }
    : { '#': '#5a1430', h: '#ffc2d2', o: '#ff4f7b', d: '#c92f5c' };
  s.bitmap(0, 0, HEART_ROWS, col);
  return { s, ax: 3, ay: 6 };
}

// Пуля-трассер: горизонтальная, поворачивается при отрисовке.
function paintBullet(core, glow) {
  const s = new Spr(9, 3);
  s.rect(0, 1, 3, 1, glow); s.rect(3, 0, 5, 3, glow); s.rect(3, 1, 6, 1, core); s.px(8, 1, '#ffffff');
  return { s, ax: 5, ay: 1 };
}

function paintMuzzle(v) {
  const s = new Spr(9, 9);
  const rows = v === 0
    ? ['....y....', '...yoy...', '..yowoy..', 'yyowwwoyy', '..yowoy..', '...yoy...', '....y....', '.........', '.........']
    : ['.........', 'y...y...y', '.y.yoy.y.', '..owwwo..', 'yowwwwwoy', '..owwwo..', '.y.yoy.y.', 'y...y...y', '.........'];
  s.bitmap(0, 0, rows, { y: '#ffd451', o: '#ff9a2e', w: '#ffffff' });
  return { s, ax: 1, ay: 4 };
}

function paintCrosshair() {
  const s = new Spr(11, 11);
  for (const [x, y] of [[5, 0], [5, 1], [5, 2], [5, 8], [5, 9], [5, 10], [0, 5], [1, 5], [2, 5], [8, 5], [9, 5], [10, 5], [5, 5]]) s.px(x, y, '#ffffff');
  s.outline('#1d1a24');
  return { s, ax: 5, ay: 5 };
}

function paintSpore() {
  const s = new Spr(7, 7);
  s.blob(3.5, 3.5, 2.5, 2.5, ['#3a2450', '#7b4f9c', '#a374c7', '#d4b0f0', '#f3e6ff']);
  return { s, ax: 3, ay: 3 };
}

function paintShadow() {
  const s = new Spr(14, 6);
  s.ellipse(7, 3, 6.5, 2.6, () => '#000000');
  return { s, ax: 7, ay: 3 };
}

const PLATE_COL = { '1': ['#ffcf5a', '#8a6a24'], '2': ['#c49bff', '#5d4a8a'] };

function paintPlate(id, down) {
  const s = new Spr(16, 16);
  const [lit, dim] = PLATE_COL[id];
  s.rect(1, 2, 14, 13, '#4f4b42');
  if (down) {
    s.rect(2, 4, 12, 10, '#8a8574');
  } else {
    s.rect(2, 2, 12, 11, '#a7a291'); s.rect(2, 2, 12, 1, '#c8c2ac'); s.rect(2, 12, 12, 2, '#6b6658');
  }
  const oy = down ? 1 : 0;
  const c = down ? lit : dim;
  s.bitmap(5, 4 + oy, ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'], { '#': c });
  if (down) s.px(7, 6 + oy, '#ffffff');
  return { s, ax: 8, ay: 8 };
}

function paintDoor(id, stage) {
  const s = new Spr(16, 16);
  const len = stage === 0 ? 16 : stage === 1 ? 8 : 3;
  for (const x of [2, 6, 10, 13]) {
    for (let y = 0; y < len; y++) { s.px(x, y, '#9aa3ad'); s.px(x + 1, y, '#5a6068'); }
    if (stage === 0) s.px(x, 15, '#c8d0d8');
  }
  if (len > 4) { s.rect(1, 3, 14, 2, '#6b737c'); s.rect(1, 3, 14, 1, '#aeb6bf'); }
  if (len > 10) s.rect(1, 10, 14, 2, '#6b737c');
  if (len > 4) { s.px(7, 3, PLATE_COL[id][0]); s.px(8, 3, PLATE_COL[id][0]); }
  return { s, ax: 8, ay: 8 };
}

function paintExit(el, on) {
  const s = new Spr(16, 16);
  const ring = el === 'fire' ? (on ? '#ffd451' : '#a8582a') : (on ? '#bfe6ff' : '#3f6a9a');
  const glyph = el === 'fire' ? (on ? '#ff7a2a' : '#7a3a1a') : (on ? '#4aa3ff' : '#2a4a72');
  s.ellipse(8, 8, 7.5, 7.5, () => ring);
  s.ellipse(8, 8, 6, 6, () => (on ? (el === 'fire' ? '#7a2a14' : '#163a6a') : '#4f4b42'));
  if (el === 'fire') s.bitmap(5, 3, ['..#...', '..##..', '.###..', '.####.', '######', '.####.', '..##..'], { '#': glyph });
  else s.bitmap(5, 3, ['..##..', '..##..', '.####.', '######', '######', '.####.', '..##..'], { '#': glyph });
  return { s, ax: 8, ay: 8 };
}

function paintGem(el) {
  const s = new Spr(9, 9);
  const col = el === 'fire'
    ? { '#': '#5a140c', h: '#ffe0b0', o: '#ff5a2a', d: '#b8301a' }
    : { '#': '#0c2a5a', h: '#e0f4ff', o: '#3aa0ff', d: '#1a5ab8' };
  s.bitmap(1, 1, ['.#####.', '#hhoood', '#hoooo#', '.#ood#.', '..#d#..', '...#...'], col);
  s.outline(el === 'fire' ? '#ffd9a8' : '#c8ecff');
  return { s, ax: 4, ay: 8 };
}

function paintIcon(el) {
  const s = new Spr(9, 10);
  if (el === 'fire') s.bitmap(1, 1, ['...o...', '..oo...', '.oyoo..', '.oyyo.o', 'ooyyyoo', 'oyyyyyo', '.oyyyo.', '..ooo..'], { o: '#ff6a2a', y: '#ffd451' });
  else s.bitmap(1, 1, ['...b...', '...b...', '..bbb..', '.bbbbb.', 'bwbbbbb', 'bwbbbbb', '.bbbbb.', '..bbb..'], { b: '#3aa0ff', w: '#e0f4ff' });
  s.outline('#1d1a24');
  return { s, ax: 4, ay: 9 };
}

function paintMarker() {
  const s = new Spr(9, 6);
  s.bitmap(1, 1, ['#######', '.#####.', '..###..', '...#...'], { '#': '#ffffff' });
  s.outline('#1d1a24');
  return { s, ax: 4, ay: 5 };
}

// Сторонние спрайты (CC0) увеличиваем в целое число раз без сглаживания.
function envSprites(env) {
  const out = {};
  if (!env) return out;
  for (const [name, r] of Object.entries(env.meta.sprites)) {
    const k = Math.max(1, r.scale | 0);
    const c = makeCanvas(r.w * k, r.h * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(env.image, r.x, r.y, r.w, r.h, 0, 0, r.w * k, r.h * k);
    out[name] = { s: { w: r.w * k, h: r.h * k, canvas: c }, ax: r.ax * k + Math.floor(k / 2), ay: r.ay * k + k - 1 };
  }
  return out;
}

// Собираем все спрайты в один атлас (полочная упаковка). env — CC0-спрайты из assets/env.png.
export function buildObjectAtlas(env) {
  const list = {
    ...envSprites(env),
    bush0: paintBush(0), bush1: paintBush(1), bush2: paintBush(2), bush3: paintBush(3),
    rock0: paintRock(0), rock1: paintRock(1),
    fence: paintFence(), sign: paintSign(), gate: paintGate(),
    // Больше кадров — плавнее движение.
    slime0: paintSlime(6.5, 5), slime1: paintSlime(7, 4.6), slime2: paintSlime(6.5, 5, true), slime3: paintSlime(6, 5.4),
    slimeUp: paintSlime(5.2, 6.4), slimeDown: paintSlime(8.2, 3.6),
    bat0: paintBat(5), bat1: paintBat(2), bat2: paintBat(-3), bat3: paintBat(1),
    mushroom0: paintMushroom(0), mushroom1: paintMushroom(1), mushroom2: paintMushroom(1), mushroom3: paintMushroom(0, 0, true),
    mushroomS0: paintMushroom(2, 1.5), mushroomS1: paintMushroom(-1, -0.5),
    heart: paintHeart(false), heartEmpty: paintHeart(true),
    bulletAk: paintBullet('#fff3b0', '#ffb43a'), muzzle0: paintMuzzle(0), muzzle1: paintMuzzle(1), crosshair: paintCrosshair(), spore: paintSpore(), shadow: paintShadow(),
    plate1Up: paintPlate('1', false), plate1Down: paintPlate('1', true),
    plate2Up: paintPlate('2', false), plate2Down: paintPlate('2', true),
    door1_0: paintDoor('1', 0), door1_1: paintDoor('1', 1), door1_2: paintDoor('1', 2),
    door2_0: paintDoor('2', 0), door2_1: paintDoor('2', 1), door2_2: paintDoor('2', 2),
    exitFire0: paintExit('fire', false), exitFire1: paintExit('fire', true),
    exitWater0: paintExit('water', false), exitWater1: paintExit('water', true),
    gemFire: paintGem('fire'), gemWater: paintGem('water'),
    iconFire: paintIcon('fire'), iconWater: paintIcon('water'), marker: paintMarker(),
  };
  const PAD = 2, MAXW = 512;
  let x = PAD, y = PAD, rowH = 0;
  const rects = {};
  for (const [name, { s, ax, ay }] of Object.entries(list)) {
    if (x + s.w + PAD > MAXW) { x = PAD; y += rowH + PAD; rowH = 0; }
    rects[name] = { x, y, w: s.w, h: s.h, ax, ay, src: s.canvas };
    x += s.w + PAD;
    rowH = Math.max(rowH, s.h);
  }
  const H = nextPow2(y + rowH + PAD);
  const canvas = makeCanvas(MAXW, H);
  const ctx = canvas.getContext('2d');
  for (const r of Object.values(rects)) { ctx.drawImage(r.src, r.x, r.y); delete r.src; }
  return { canvas, rects };
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// Иконка сердца для HUD (data URL), масштаб 3.
export function heartIconURL(empty) {
  const { s } = paintHeart(empty);
  const c = makeCanvas(21, 21);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, 0, 0, 21, 21);
  return c.toDataURL();
}

export function iconURL(name) {
  const painters = { fire: () => paintIcon('fire'), water: () => paintIcon('water'), gemFire: () => paintGem('fire'), gemWater: () => paintGem('water') };
  const { s } = painters[name]();
  const k = 3;
  const c = makeCanvas(s.w * k, s.h * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.canvas, 0, 0, s.w * k, s.h * k);
  return c.toDataURL();
}
