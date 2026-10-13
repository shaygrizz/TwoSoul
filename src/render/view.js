// Отрисовка на three.js. Ортокамера, целочисленный масштаб пикселей, сортировка по глубине через z.
// Логика сюда не попадает: сцены только читают состояние и рисуют его.
import * as THREE from '../../lib/three.module.min.js';
import { CFG } from '../config.js';
import { paintGround, buildObjectAtlas, LIQUID_FRAMES } from './pixelart.js';

const Z_GROUND = -100, Z_DECAL = -90, Z_SHADOW = -80, Z_TOP = 90;
const depth = (y) => y * 0.01;

// Позиции округляются до пикселя экрана, а не до пикселя мира: движение плавное, пиксели чёткие.
let PX = 1;
const snap = (v) => Math.round(v * PX) / PX;
const lerp = (a, b, t) => a + (b - a) * t;

// Материал с белой вспышкой при попадании (uniform uFlash 0..1).
function flashMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5 });
  const u = { value: 0 };
  m.userData.flash = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlash = u;
    sh.fragmentShader = 'uniform float uFlash;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uFlash);',
    );
  };
  m.customProgramCacheKey = () => 'flash-v1';
  return m;
}

// Мягкое свечение (как подсветка в пещерном стиле): радиальный градиент, аддитивное смешивание.
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Glow {
  constructor(geo, tex, parent, color, size, opacity) {
    this.mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.size = size; this.base = opacity;
    this.mesh.scale.set(size, size, 1);
    parent.add(this.mesh);
  }
  place(x, y, z = 0, k = 1) {
    this.mesh.position.set(snap(x), snap(-y + z), depth(y) + 0.02);
    this.mesh.scale.set(this.size * k, this.size * k, 1);
  }
  alpha(a) { this.mat.opacity = this.base * a; }
  show(v) { this.mesh.visible = v; }
  dispose() { this.mat.dispose(); this.mesh.removeFromParent(); }
}

// Пружина для «сжатия-растяжения»: небольшой перелёт делает движение живым.
class Squash {
  constructor() { this.sx = 1; this.sy = 1; this.vx = 0; this.vy = 0; }
  hit(sx, sy) { this.sx = sx; this.sy = sy; this.vx = 0; this.vy = 0; }
  update(dt) {
    const K = 420, D = 2 * Math.sqrt(K) * 0.55;
    const step = Math.min(dt, 1 / 30);
    this.vx += ((1 - this.sx) * K - this.vx * D) * step; this.sx += this.vx * step;
    this.vy += ((1 - this.sy) * K - this.vy * D) * step; this.sy += this.vy * step;
    if (!Number.isFinite(this.sx) || !Number.isFinite(this.sy)) this.hit(1, 1);
  }
}

function pixelTexture(source) {
  const t = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// В офлайн-сборке (один HTML-файл) картинки и JSON лежат внутри страницы: window.__EMBED.
export function assetURL(url) {
  const e = typeof window !== 'undefined' && window.__EMBED;
  if (e && e.files && e.files[url]) return e.files[url];
  // Версия в адресе: после замены картинок браузер не покажет старые из кэша.
  return url + '?v=' + CFG.ASSET_VERSION;
}

export async function loadJSON(url) {
  const e = typeof window !== 'undefined' && window.__EMBED;
  if (e && e.json && e.json[url]) return e.json[url];
  const res = await fetch(url + '?v=' + CFG.ASSET_VERSION);
  if (!res.ok) throw new Error('Не удалось загрузить ' + url);
  return res.json();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить ' + url));
    img.src = assetURL(url);
  });
}

// Прямоугольник кадра + точка привязки.
function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

function writeQuad(pos, uv, o, uo, r, texW, texH, flip, ox = 0, oy = 0, oz = 0) {
  let x0 = -r.ax, x1 = r.w - r.ax;
  if (flip) { const t = x0; x0 = -x1; x1 = -t; }
  const yTop = r.ay, yBot = r.ay - r.h;
  const pts = [x0, yTop, x1, yTop, x1, yBot, x0, yBot];
  for (let i = 0; i < 4; i++) {
    pos[o + i * 3] = pts[i * 2] + ox;
    pos[o + i * 3 + 1] = pts[i * 2 + 1] + oy;
    pos[o + i * 3 + 2] = oz;
  }
  let u0 = r.x / texW, u1 = (r.x + r.w) / texW;
  if (flip) { const t = u0; u0 = u1; u1 = t; }
  const v0 = 1 - r.y / texH, v1 = 1 - (r.y + r.h) / texH;
  const uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
  for (let i = 0; i < 8; i++) uv[uo + i] = uvs[i];
}

class Sprite {
  constructor(material, texW, texH, parent) {
    this.geo = quadGeometry();
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.texW = texW; this.texH = texH;
    this.rect = null; this.flip = false;
    parent.add(this.mesh);
  }
  frame(rect, flip = false) {
    if (rect === this.rect && flip === this.flip) return;
    this.rect = rect; this.flip = flip;
    writeQuad(this.geo.attributes.position.array, this.geo.attributes.uv.array, 0, 0, rect, this.texW, this.texH, flip);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
  }
  // x, y — точка на земле; z — высота над землёй.
  place(x, y, z = 0, zLayer = null) {
    this.mesh.position.set(snap(x), snap(-y + z), zLayer === null ? depth(y) : zLayer);
  }
  scale(sx, sy) { this.mesh.scale.set(sx, sy, 1); }
  rotate(a) { this.mesh.rotation.z = a; }
  show(v) { this.mesh.visible = v; }
  dispose() { this.geo.dispose(); this.mesh.removeFromParent(); }
}

// Руки героя с огнестрелом: рукав от плеча к кисти и кисть на оружии. Рисуется на маленьком холсте
// в масштабе 1:1 и каждый кадр обновляется, поэтому руки следуют за прицелом в любую сторону.
const ARM_CANVAS = 56, ARM_OX = 28, ARM_OY = 44;   // точка «ноги героя» на холсте
class ArmsLayer {
  constructor(parent, owner) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ARM_CANVAS;
    this.ctx = this.canvas.getContext('2d');
    this.tex = pixelTexture(this.canvas);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, alphaTest: 0.5 });
    this.sprite = new Sprite(this.mat, ARM_CANVAS, ARM_CANVAS, parent);
    this.sprite.frame({ x: 0, y: 0, w: ARM_CANVAS, h: ARM_CANVAS, ax: ARM_OX, ay: ARM_OY });
    this.sprite.show(false);
    owner.push(this);
  }
  box(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(ARM_OX + x), Math.round(ARM_OY - y), w, h);
  }
  // Рука из плеча (sx, sy) в кисть (hx, hy); координаты от ног героя, y вверх. Локоть чуть вниз.
  limb(sx, sy, hx, hy, pal) {
    const ex = (sx + hx) / 2, ey = (sy + hy) / 2 - 2.2;
    const pts = [];
    for (const [a, b] of [[[sx, sy], [ex, ey]], [[ex, ey], [hx, hy]]]) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
      for (let i = pts.length ? 1 : 0; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    }
    for (const [x, y] of pts) this.box(x - 1, y + 1, 4, 4, pal.outline);
    pts.forEach(([x, y], i) => this.box(x, y, 2, 2, i / (pts.length - 1) < pal.sleeveFrac ? pal.sleeve : pal.skin));
    // Кисть: кожа 2×2 в рамке.
    this.box(hx - 1, hy + 2, 4, 4, pal.outline);
    this.box(hx, hy + 1, 2, 2, pal.skin);
  }
  draw(arms, pal) {
    this.ctx.clearRect(0, 0, ARM_CANVAS, ARM_CANVAS);
    for (const a of arms) this.limb(a.sx, a.sy, a.hx, a.hy, pal);
    this.tex.needsUpdate = true;
  }
  dispose() { this.tex.dispose(); this.mat.dispose(); this.sprite.dispose(); }
}

// Частицы: квадратные пиксели, один InstancedMesh на сцену.
class Particles {
  constructor(parent, max = 500) {
    this.max = max;
    this.items = Array.from({ length: max }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, size: 1, max: 1 }));
    this.mat = new THREE.MeshBasicMaterial();
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new Float32Array(max * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.count = 0;
    this.m4 = new THREE.Matrix4();
    this.color = new THREE.Color();
    this.cursor = 0;
    parent.add(this.mesh);
  }
  spawn(x, y, z, vx, vy, vz, life, hex, size = 1, g = 0) {
    // Кольцевой буфер: если всё занято, перезаписываем самую старую.
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life; p.size = size; p.g = g;
    this.color.set(hex).convertSRGBToLinear();
    p.r = this.color.r; p.gc = this.color.g; p.b = this.color.b;
  }
  update(dt) {
    let n = 0;
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vz -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz = 0; p.vx *= 0.8; p.vy *= 0.8; }
      const s = p.size * Math.min(1, (p.life / p.max) * 2.5);
      const ss = Math.max(1 / PX, Math.round(s * PX) / PX);
      this.m4.makeScale(ss, ss, 1);
      this.m4.setPosition(snap(p.x), snap(-p.y + p.z), depth(p.y) + 0.004);
      this.mesh.setMatrixAt(n, this.m4);
      this.colors[n * 3] = p.r; this.colors[n * 3 + 1] = p.gc; this.colors[n * 3 + 2] = p.b;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { for (const p of this.items) p.life = 0; this.mesh.count = 0; }
  dispose() { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); this.mesh.removeFromParent(); }
}

// Какой CC0-спрайт рисовать для дерева на карте.
export function treeSprite(o) {
  if (o.type === 'pine') return 'naPine';
  if (o.border) return ['naTree', 'naBigTree', 'naTree', 'naPine'][o.variant % 4];
  return ['naTree', 'naTree', 'naPinkTree', 'naBigTree'][o.variant % 4];
}

function borderVisible(o) {
  return o.ty % 2 === 0 && (o.tx + ((o.ty >> 1) % 2)) % 3 === 0;
}

// Смещение угла топора относительно прицела (радианы): замах вверх, удар вниз, возврат.
function swingOffset(h, W) {
  const REST = 1.0, UP = 1.75, DOWN = -0.85;
  if (!h.swingT || h.swingT <= 0) return REST;
  const t = Math.min(1, h.swingT / W.swingTime);
  if (t < 0.22) { const k = t / 0.22; return REST + (UP - REST) * (1 - (1 - k) * (1 - k)); }
  if (t < 0.42) { const k = (t - 0.22) / 0.2; return UP + (DOWN - UP) * (k * k); }
  const k = (t - 0.42) / 0.58;
  return DOWN + (REST - DOWN) * (1 - Math.pow(1 - k, 3));
}

// Анимации по видам (спереди, сзади, сбоку): строка листа, число кадров, fps, зацикленность.
function parseHeroAnims(meta) {
  const [fw, fh] = meta.frame || [];
  if (!(fw > 0 && fh > 0) || !Array.isArray(meta.anchor)) throw new Error('В атласе героя нет размера кадра');
  if (!meta.views || !meta.views.front || !meta.views.front.idle) throw new Error('В атласе героя нет анимаций');
  const out = {};
  for (const [view, anims] of Object.entries(meta.views)) {
    out[view] = {};
    for (const [name, d] of Object.entries(anims)) {
      const n = Math.max(1, d.frames | 0);
      const rects = [];
      // Анимации с оружием могут быть крупнее обычных (замах топором): свой размер кадра и точка опоры.
      const w = d.fw || fw, h = d.fh || fh, y = Number.isFinite(d.y) ? d.y : d.row * fh;
      for (let i = 0; i < n; i++) rects.push({ x: i * w, y, w, h, ax: d.ax ?? meta.anchor[0], ay: d.ay ?? meta.anchor[1] });
      out[view][name] = { rects, fps: d.fps > 0 ? d.fps : 8, loop: d.loop !== false };
    }
  }
  return out;
}

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x1c2f22, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.camera.position.z = 1000;
    this.scale = 1;
    this.devW = 1; this.devH = 1;
    this.scene = null;
  }

  async load() {
    const [herImg, himImg] = await Promise.all([loadImage(CFG.HEROES.her.sheet), loadImage(CFG.HEROES.him.sheet)]);
    this.heroTex = { her: pixelTexture(herImg), him: pixelTexture(himImg) };
    // Отдельный лист «без рук» нужен только героям, у которых руки рисуются поверх оружия (sheetArmed в конфиге).
    this.heroTexArmed = {};
    for (const kind of ['her', 'him']) {
      const armed = CFG.HEROES[kind].sheetArmed;
      if (armed) this.heroTexArmed[kind] = pixelTexture(await loadImage(armed));
    }
    this.heroTexSize = { her: [herImg.width, herImg.height], him: [himImg.width, himImg.height] };
    this.heroMat = {
      her: new THREE.MeshBasicMaterial({ map: this.heroTex.her, alphaTest: 0.5 }),
      him: new THREE.MeshBasicMaterial({ map: this.heroTex.him, alphaTest: 0.5 }),
    };
    this.glowTex = glowTexture();
    // CC0-спрайты (деревья, дома, пень, дрова) добавляются в общий атлас объектов.
    const envMeta = await loadJSON('assets/env_atlas.json');
    const envImg = await loadImage(envMeta.image);
    const atlas = buildObjectAtlas({ image: envImg, meta: envMeta });
    this.atlas = atlas;
    this.atlasTex = pixelTexture(atlas.canvas);
    this.atlasMat = new THREE.MeshBasicMaterial({ map: this.atlasTex, alphaTest: 0.5 });
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.atlasTex, transparent: true, opacity: 0.22, depthWrite: false, alphaTest: 0.5 });
    // Оружие: отдельная картинка и JSON-атлас с точкой хвата и дула.
    const wmeta = await loadJSON('assets/weapons_atlas.json');
    const wimg = await loadImage(wmeta.image);
    this.weaponImg = wimg;
    this.weaponTex = pixelTexture(wimg);
    this.weaponTexSize = [wimg.width, wimg.height];
    this.weaponMat = new THREE.MeshBasicMaterial({ map: this.weaponTex, alphaTest: 0.5 });
    this.weapons = {};
    for (const [id, r] of Object.entries(wmeta.weapons)) {
      this.weapons[id] = { x: r.x, y: r.y, w: r.w, h: r.h, ax: r.pivot[0], ay: r.pivot[1], mx: r.muzzle[0], my: r.muzzle[1] };
    }
    // Кадры героев: у каждого свой атлас (размер кадра, точка опоры, высота оружия).
    this.heroMeta = {};
    this.heroAnims = {};
    this.heroGunHeight = {};
    for (const kind of ['her', 'him']) {
      const meta = await loadJSON(CFG.HEROES[kind].atlas);
      this.heroMeta[kind] = meta;
      this.heroAnims[kind] = parseHeroAnims(meta);
      this.heroGunHeight[kind] = Number.isFinite(meta.gunHeight) ? meta.gunHeight : CFG.GUN_HEIGHT;
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, CFG.VIEW.maxDpr);
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    this.devW = Math.round(w * dpr);
    this.devH = Math.round(h * dpr);
    this.dpr = dpr;
  }

  // Масштаб: сколько экранных пикселей на пиксель мира (целое число).
  setScaleFor(mode, mapW, mapH) {
    let s;
    if (mode === 'fit') s = Math.floor(Math.min(this.devW / mapW, this.devH / mapH));
    else s = Math.floor(Math.min(this.devW, this.devH) / CFG.VIEW.targetWorldPx);
    this.scale = Math.max(1, s);
    PX = this.scale;
    const hw = this.devW / 2 / this.scale, hh = this.devH / 2 / this.scale;
    this.camera.left = -hw; this.camera.right = hw;
    this.camera.top = hh; this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
  }

  lookAt(x, y, mapW, mapH) {
    const vw = this.devW / this.scale, vh = this.devH / this.scale;
    let cx = mapW <= vw ? mapW / 2 : Math.min(Math.max(x, vw / 2), mapW - vw / 2);
    let cy = mapH <= vh ? mapH / 2 : Math.min(Math.max(y, vh / 2), mapH - vh / 2);
    // Совмещаем сетку пикселей мира с пикселями экрана.
    cx = (Math.round(cx * this.scale - this.devW / 2) + this.devW / 2) / this.scale;
    cy = (Math.round(cy * this.scale - this.devH / 2) + this.devH / 2) / this.scale;
    this.camera.position.x = cx;
    this.camera.position.y = -cy;
  }

  // Мировые координаты точки экрана (CSS-пиксели).
  screenToWorld(sx, sy) {
    const x = (sx * this.dpr - this.devW / 2) / this.scale + this.camera.position.x;
    const y = (sy * this.dpr - this.devH / 2) / this.scale - this.camera.position.y;
    return { x, y };
  }

  // Сцену освобождает тот, кто её создал (main), чтобы мир можно было сохранить на время испытания.
  setScene(s) { this.scene = s; }

  render() {
    if (this.scene) this.renderer.render(this.scene.root, this.camera);
  }
}

// Базовая сцена карты: земля (с кадрами жидкостей), статичные объекты, частицы.
export class MapScene {
  constructor(view, map, style) {
    this.view = view;
    this.map = map;
    this.root = new THREE.Scene();
    this.owned = []; // всё, что надо освободить
    this.sprites = [];
    this.animT = 0; this.frameIdx = 0;

    const frames = paintGround(map, style);
    this.groundTex = frames.map((c) => pixelTexture(c));
    this.groundMat = new THREE.MeshBasicMaterial({ map: this.groundTex[0] });
    const gGeo = new THREE.PlaneGeometry(map.pxW, map.pxH);
    const ground = new THREE.Mesh(gGeo, this.groundMat);
    ground.position.set(map.pxW / 2, -map.pxH / 2, Z_GROUND);
    this.root.add(ground);
    this.owned.push(gGeo, this.groundMat, ...this.groundTex);

    this.dynamicTrees = style === 'overworld';
    this.buildStatic();
    this.glowGeo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(this.glowGeo);
    this.glows = [];
    this.particles = new Particles(this.root);
  }

  rect(name) {
    const r = this.view.atlas.rects[name];
    if (!r) throw new Error('Нет спрайта ' + name);
    return r;
  }

  // Все неподвижные объекты карты — одна геометрия, один вызов отрисовки.
  buildStatic() {
    const items = [], shadows = [];
    const T0 = CFG.TILE;
    let houseN = 0; // дома по очереди получают разные спрайты
    for (const o of this.map.objects) {
      let name, x = (o.tx + 0.5) * T0, y = (o.ty + 1) * T0 - 2;
      if (o.type === 'flowers') continue;
      // Деревья внутри карты рубятся — их рисует сцена мира отдельными спрайтами.
      if ((o.type === 'tree' || o.type === 'pine') && !o.border && this.dynamicTrees) continue;
      if (o.type === 'tree' || o.type === 'pine') {
        // Лесная граница: деревья 64 px стоят на каждом тайле, поэтому рисуем реже (в шахматном порядке со сдвигом),
        // иначе кроны громоздятся друг на друга. Проходимость от этого не меняется.
        if (o.border && !borderVisible(o)) continue;
        name = treeSprite(o);
        if (o.border) { x += ((o.ty >> 1) % 2) * 8; }
        shadows.push([x, y, 2.6]);
      }
      else if (o.type === 'bush') { name = 'bush' + o.variant; shadows.push([x, y, 1.3]); }
      else if (o.type === 'rock') { name = 'rock' + (o.variant % 2); shadows.push([x, y, 1.2]); }
      else if (o.type === 'house') { name = 'naHouse' + (1 + (houseN++ % 3)); x = (o.tx - 1) * T0 + 64; y = (o.ty + 1) * T0 + 1; }
      else if (o.type === 'gate') { name = 'gate'; y = (o.ty + 1) * T0; }
      else name = o.type;
      items.push([this.rect(name), x, y]);
    }
    this.staticMesh = this.mergeQuads(items, this.view.atlasMat, (y) => depth(y));
    const sh = this.rect('shadow');
    this.staticShadow = this.mergeQuads(shadows.map(([x, y, k]) => [sh, x, y + 1, k]), this.view.shadowMat, () => Z_SHADOW);
  }

  mergeQuads(items, mat, zOf) {
    const { canvas } = this.view.atlas;
    const pos = new Float32Array(items.length * 12), uv = new Float32Array(items.length * 8);
    const idx = [];
    items.forEach(([r, x, y, k = 1], i) => {
      writeQuad(pos, uv, i * 12, i * 8, r, canvas.width, canvas.height, false, Math.round(x), Math.round(-y), zOf(y));
      if (k !== 1) { // растягиваем тень вокруг её центра
        for (let v = 0; v < 4; v++) {
          const o = i * 12 + v * 3;
          pos[o] = Math.round(x) + (pos[o] - Math.round(x)) * k;
          pos[o + 1] = Math.round(-y) + (pos[o + 1] - Math.round(-y)) * Math.max(1, k * 0.7);
        }
      }
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    this.root.add(m);
    this.owned.push(g);
    return m;
  }

  atlasSprite(mat = this.view.atlasMat) {
    const { canvas } = this.view.atlas;
    const s = new Sprite(mat, canvas.width, canvas.height, this.root);
    this.sprites.push(s);
    return s;
  }

  heroSprite(kind, armed = false) {
    const [w, h] = this.view.heroTexSize[kind];
    const mat = flashMaterial(armed ? this.view.heroTexArmed[kind] : this.view.heroTex[kind]);
    this.owned.push(mat);
    const s = new Sprite(mat, w, h, this.root);
    s.mat = mat;
    this.sprites.push(s);
    return s;
  }

  glow(color, size, opacity = 0.5) {
    const g = new Glow(this.glowGeo, this.view.glowTex, this.root, color, size, opacity);
    this.glows.push(g);
    return g;
  }

  flashSprite() {
    const mat = flashMaterial(this.view.atlasTex);
    this.owned.push(mat);
    const s = this.atlasSprite(mat);
    s.mat = mat;
    return s;
  }

  weaponSprite(id) {
    const [w, h] = this.view.weaponTexSize;
    const s = new Sprite(this.view.weaponMat, w, h, this.root);
    s.frame(this.view.weapons[id]);
    this.sprites.push(s);
    return s;
  }

  // Набор спрайтов героя: тело, тень, по желанию оружие и вспышка выстрела.
  heroView(h) {
    const v = { shadow: this.shadowSprite(), spr: this.heroSprite(h.kind), sq: new Squash(), flash: 0, dustT: 0 };
    if (h.gun) {
      if (this.view.heroTexArmed[h.kind]) {
        v.sprArmed = this.heroSprite(h.kind, true);   // тело без рук: их рисует ArmsLayer по прицелу
        v.sprArmed.show(false);
        v.arms = new ArmsLayer(this.root, this.owned);
      }
      // По спрайту на каждое оружие героя; видно только текущее.
      v.weaponSprites = {};
      for (const id of h.weapons.length ? h.weapons : [h.gun]) {
        const ws = this.weaponSprite(id);
        ws.show(false);
        v.weaponSprites[id] = ws;
      }
      v.gunId = h.gun;
      v.gun = v.weaponSprites[h.gun];
      v.gunRect = this.view.weapons[h.gun];
      v.pop = 0;
      v.muzzle = this.atlasSprite();
      v.muzzle.show(false);
      v.muzzleGlow = this.glow(0xffc060, 30, 0.6);
      v.muzzleGlow.show(false);
      v.gunAngle = Math.atan2(-h.aimY, h.aimX);
      v.recoil = 0; v.muzzleT = 0; v.muzzleFrame = 0;
    }
    return v;
  }

  shadowSprite() {
    const s = this.atlasSprite(this.view.shadowMat);
    s.frame(this.rect('shadow'));
    return s;
  }

  // Анимация жидкостей и частиц.
  tick(dt) {
    this.animT += dt;
    if (this.animT > 0.2) {
      this.animT = 0;
      this.frameIdx = (this.frameIdx + 1) % LIQUID_FRAMES;
      this.groundMat.map = this.groundTex[this.frameIdx];
    }
    this.particles.update(dt);
  }

  // Позиция героя между двумя шагами логики.
  heroPos(h, alpha) {
    return { x: lerp(h.px, h.x, alpha), y: lerp(h.py, h.y, alpha), z: lerp(h.pz, h.z, alpha) };
  }

  // Куда смотрит герой: спереди, сзади или сбоку. С запасом, чтобы вид не дрожал на диагоналях.
  pickView(v, h) {
    // Тело смотрит на мышь или туда, куда стреляет; иначе — по ходу движения.
    const byAim = h.gun && (h.aimByMouse || h.shootCd > 0);
    const dx = byAim ? h.aimX : h.dirX, dy = byAim ? h.aimY : h.dirY;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const cur = v.view || 'front';
    if (cur === 'side') { if (ay > ax * 1.4) v.view = dy < 0 ? 'back' : 'front'; }
    else if (ax > ay * 1.1) v.view = 'side';
    else v.view = dy < 0 ? 'back' : 'front';
    return v.view || 'front';
  }

  drawHero(v, h, alpha, dt) {
    const all = this.view.heroAnims[h.kind] || this.view.heroAnims.her;
    const view = this.pickView(v, h);
    // С оружием в руках берём анимацию «имя_оружие», если она нарисована. Иначе обычную, а вращающееся оружие
    // рисуем поверх (герои без нарисованного оружия).
    const armedName = h.gun ? h.anim + '_' + h.gun : '';
    v.baked = Boolean(h.gun && all.front['idle_' + h.gun]);
    v.bakedNow = Boolean(v.baked && all[view] && all[view][armedName]);
    // Нет анимации в этом виде — берём вид спереди, затем покой.
    const A = (v.bakedNow && all[view][armedName]) || (all[view] && all[view][h.anim]) || all.front[h.anim] || all.front.idle;
    const step = Math.floor(h.animT * A.fps);
    let idx = A.loop ? step % A.rects.length : Math.min(step, A.rects.length - 1);
    // Идёт спиной вперёд (смотрит в одну сторону, движется в другую): бег проигрывается в обратную сторону.
    if ((h.anim === 'run' || h.anim === 'walk') && A.loop) {
      const fx = view === 'side' ? h.facing : 0, fy = view === 'front' ? 1 : view === 'back' ? -1 : 0;
      if (h.vx * fx + h.vy * fy < -0.5 * Math.hypot(h.vx, h.vy)) idx = A.rects.length - 1 - idx;
    }
    const p = this.heroPos(h, alpha);
    v.sq.update(dt);
    v.flash = Math.max(0, v.flash - dt * 8);
    // С огнестрелом берём лист без рук (кроме ударов и радости, где руки нужны на теле).
    const W0 = h.gun ? CFG.WEAPONS[h.gun] : null;
    v.armed = Boolean(v.sprArmed && W0 && W0.type === 'gun' && !h.dead && h.anim !== 'hurt' && h.anim !== 'cheer' && h.anim !== 'cast');
    const body = v.armed ? v.sprArmed : v.spr;
    if (v.sprArmed) { (v.armed ? v.spr : v.sprArmed).show(false); v.sprArmed.mat.userData.flash.value = v.flash; }
    body.frame(A.rects[idx], h.facing < 0);
    // Отдача: выстрел подбрасывает героя с оружием назад и чуть вверх, затем он возвращается.
    let kx = 0, ky = 0;
    if (v.baked && v.bakedNow && v.recoil > 0.02) {
      const dirx = view === 'side' ? (h.facing < 0 ? -1 : 1) : 0;
      kx = -dirx * v.recoil * 2;
      ky = v.recoil * 1.5;
    }
    body.place(p.x + kx, p.y, p.z + ky);
    body.scale(v.sq.sx, v.sq.sy);
    v.spr.mat.userData.flash.value = v.flash;
    const blink = !h.dead && h.inv > 0 && v.flash <= 0 && Math.floor(h.inv * 14) % 2 === 1;
    const visible = !blink && !(h.dead && h.deadT < 0.6 && Math.floor(h.deadT * 20) % 2 === 0);
    body.show(visible);
    // Тень сжимается, когда герой в воздухе.
    const k = 1 - Math.min(0.45, p.z / 60);
    v.shadow.place(p.x, p.y + 1, 0, Z_SHADOW);
    v.shadow.scale(k, k);
    v.shadow.show(true);

    // Пыль из-под ног на бегу.
    const speed = Math.hypot(h.vx, h.vy);
    if (h.z === 0 && speed > 40 && !h.dead) {
      v.dustT += dt;
      if (v.dustT > 0.09) {
        v.dustT = 0;
        this.particles.spawn(p.x - h.vx * 0.06 + (Math.random() - 0.5) * 4, p.y + 1, 1, -h.vx * 0.15, -h.vy * 0.15, 8 + Math.random() * 6, 0.35,
          Math.random() < 0.5 ? '#d9c39c' : '#b5a27a', 1, 30);
      }
    }
    if (v.gun) this.drawGun(v, h, p, dt, visible);
  }

  drawGun(v, h, p, dt, visible) {
    // Сменилось оружие — прячем старое, новое «выпрыгивает» в руку.
    if (h.gun !== v.gunId && v.weaponSprites[h.gun]) {
      v.gun.show(false);
      v.gunId = h.gun;
      v.gun = v.weaponSprites[h.gun];
      v.gunRect = this.view.weapons[h.gun];
      v.pop = 1;
    }
    v.pop = Math.max(0, v.pop - dt * 5);
    const W = CFG.WEAPONS[h.gun];
    const melee = W && W.type === 'melee';
    const target = Math.atan2(-h.aimY, h.aimX);
    let d = target - v.gunAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // кратчайший поворот
    v.gunAngle += d * (1 - Math.exp(-dt * CFG.FEEL.gunTurn));
    v.recoil *= Math.exp(-dt * 16);
    v.muzzleT = Math.max(0, v.muzzleT - dt);
    if (v.baked) { this.drawBakedGun(v, h, p, visible); return; }
    const side = Math.cos(v.gunAngle) < 0 ? -1 : 1;
    // Топор: в покое поднят над плечом, при ударе описывает дугу вниз (через three.js-поворот).
    const a = melee ? v.gunAngle + side * swingOffset(h, W) : v.gunAngle;
    const c = Math.cos(a), s = Math.sin(a);
    const GS = CFG.GUN_SCALE * (1 + v.pop * 0.35);
    const mirror = side;
    const bob = h.anim === 'run' || h.anim === 'walk' ? Math.sin(h.animT * Math.PI * (h.anim === 'run' ? 5 : 4)) * 0.6 : Math.sin(h.animT * 3) * 0.3;
    const back = 3 - v.recoil * 3.5;
    // Точка хвата в координатах сцены (y вверх).
    // Когда ствол смотрит вверх или вниз, оружие смещается вбок, чтобы не прятаться за героем.
    const gx = p.x + c * back + h.facing * 5 * (1 - Math.abs(c));
    const gy = -p.y + p.z + (this.view.heroGunHeight[h.kind] ?? CFG.GUN_HEIGHT) * v.sq.sy + s * back + bob;
    const up = h.aimY < -0.45; // ствол вверх — оружие за героем
    v.gun.mesh.position.set(snap(gx), snap(gy), depth(p.y) + (up ? -0.003 : 0.003));
    v.gun.rotate(a);
    v.gun.scale(GS, GS * mirror);
    v.gun.show(visible && !h.dead);
    v.gunPivot = { x: gx, y3: gy, groundY: p.y };
    if (v.arms) this.drawArms(v, h, p, { c, s, GS, back, gx, gy, up, visible: visible && !h.dead && v.armed && !melee });

    const r = v.gunRect;
    const lx = (r.mx - r.ax) * GS, ly = (r.ay - r.my) * GS * mirror;
    const mx = gx + lx * c - ly * s, my = gy + lx * s + ly * c;
    v.muzzlePos = { x: mx, y3: my };
    if (melee) this.swingTrail(v, h);
    if (v.muzzleT > 0 && visible && !melee) {
      v.muzzle.frame(this.rect('muzzle' + v.muzzleFrame));
      v.muzzle.mesh.position.set(snap(mx), snap(my), depth(p.y) + 0.006);
      v.muzzle.rotate(a);
      v.muzzle.scale(1, mirror);
      v.muzzle.show(true);
    } else v.muzzle.show(false);
    if (v.muzzleGlow) {
      v.muzzleGlow.show(v.muzzleT > 0 && visible);
      v.muzzleGlow.place(mx, p.y, my + p.y, 1 + v.muzzleT * 8);
    }
  }

  // Оружие нарисовано прямо в кадрах героя, руки его держат. Здесь только вспышка выстрела у дула
  // (точка дула для каждого вида лежит в атласе героя) и точка вылета гильз.
  drawBakedGun(v, h, p, visible) {
    for (const s of Object.values(v.weaponSprites)) s.show(false);
    if (v.arms) v.arms.sprite.show(false);
    const W = CFG.WEAPONS[h.gun];
    const view = v.view || 'front';
    const sx = h.facing < 0 ? -1 : 1;
    const m = this.view.heroMeta[h.kind]?.muzzle?.[view] || [20, 15];
    const mx = p.x + m[0] * sx, my = -p.y + p.z + m[1] * v.sq.sy;
    // Куда смотрит ствол на экране: вбок, на зрителя или от него.
    v.gunAngle = view === 'side' ? (sx > 0 ? 0 : Math.PI) : view === 'front' ? -Math.PI / 2 : Math.PI / 2;
    const c = Math.cos(v.gunAngle), s = Math.sin(v.gunAngle);
    v.muzzlePos = { x: mx, y3: my };
    v.gunPivot = { x: mx - c * 12, y3: my - s * 12, groundY: p.y };
    const show = v.muzzleT > 0 && visible && v.bakedNow && !h.dead && W && W.type !== 'melee';
    if (show) {
      v.muzzle.frame(this.rect('muzzle' + v.muzzleFrame));
      v.muzzle.mesh.position.set(snap(mx), snap(my), depth(p.y) + (view === 'back' ? -0.003 : 0.006));
      v.muzzle.rotate(v.gunAngle);
      v.muzzle.scale(1, c < -0.5 ? -1 : 1);
      v.muzzle.show(true);
    } else v.muzzle.show(false);
    if (v.muzzleGlow) {
      v.muzzleGlow.show(Boolean(show));
      v.muzzleGlow.place(mx, p.y, my + p.y, 1 + v.muzzleT * 8);
    }
  }

  // Руки на оружии: задняя кисть на рукояти, передняя на цевье; рукава тянутся к плечам героя.
  drawArms(v, h, p, g) {
    const arms = v.arms;
    arms.sprite.show(g.visible);
    if (!g.visible) return;
    const sh = 18 * v.sq.sy, spread = v.view === 'side' ? 3 : 5;
    const gripX = g.gx - p.x, gripY = g.gy + p.y - p.z;
    const L = 12 * g.GS;      // от рукояти до цевья АК (в пикселях спрайта 12)
    const fore = { x: gripX + g.c * L, y: gripY + g.s * L };
    // Задняя рука — со стороны, противоположной стволу; передняя тянется к цевью.
    const rearSign = g.c >= 0 ? -1 : 1;
    arms.draw([
      { sx: rearSign * spread, sy: sh, hx: gripX, hy: gripY },
      { sx: -rearSign * spread, sy: sh, hx: fore.x, hy: fore.y },
    ], CFG.HEROES[h.kind].arm);
    arms.sprite.place(p.x, p.y, p.z, depth(p.y) + (g.up ? -0.0025 : 0.0035));
  }

  // След от топора: светлые искорки вдоль лезвия во время удара.
  swingTrail(v, h) {
    const W = CFG.WEAPONS[h.gun];
    if (!W || W.type !== 'melee' || h.swingT <= 0 || !v.muzzlePos || !v.gunPivot) return;
    const t = h.swingT / W.swingTime;
    if (t < 0.22 || t > 0.62) return;
    const g = v.gunPivot.groundY;
    for (let i = 0; i < 2; i++) {
      this.particles.spawn(v.muzzlePos.x + (Math.random() - 0.5) * 3, g, v.muzzlePos.y3 + g + (Math.random() - 0.5) * 3, 0, 0, 0, 0.16,
        Math.random() < 0.5 ? '#ffffff' : '#dfe8ff', 1, 0);
    }
    // Светящаяся дуга: след острия, повёрнутый назад вокруг рукояти, — чем старше точка, тем теплее и тусклее.
    const rx = v.muzzlePos.x - v.gunPivot.x, ry = v.muzzlePos.y3 - v.gunPivot.y3;
    const side = Math.cos(v.gunAngle) < 0 ? -1 : 1;
    const ARC = [['#ffffff', 0.1, 0.2], ['#ffe9a8', 0.18, 0.32], ['#ffb347', 0.26, 0.44]];
    for (const [col, life, d] of ARC) {
      const c = Math.cos(d * side), s = Math.sin(d * side);
      this.particles.spawn(v.gunPivot.x + rx * c - ry * s, g, v.gunPivot.y3 + rx * s + ry * c + g, 0, 0, 0, life, col, 2, 0);
    }
  }

  // Выстрел: отдача, вспышка, гильза.
  heroShot(v) {
    if (!v.gun) return;
    v.recoil = 1;
    v.muzzleT = 0.05;
    v.muzzleFrame = (v.muzzleFrame + 1) % 2;
    const pv = v.gunPivot;
    if (!pv) return;
    const c = Math.cos(v.gunAngle);
    this.particles.spawn(pv.x, pv.groundY, pv.y3 + pv.groundY + 2, -Math.sign(c || 1) * (14 + Math.random() * 14), (Math.random() - 0.5) * 10, 50 + Math.random() * 25, 0.7, '#e8c25a', 1, 320);
    if (v.muzzlePos) {
      for (let i = 0; i < 2; i++) {
        this.particles.spawn(v.muzzlePos.x, pv.groundY, v.muzzlePos.y3 + pv.groundY, Math.cos(v.gunAngle) * 30 + (Math.random() - 0.5) * 20, 0,
          Math.sin(v.gunAngle) * 30 + (Math.random() - 0.5) * 20, 0.18, Math.random() < 0.5 ? '#ffd451' : '#ffffff', 1, 0);
      }
    }
  }

  dispose() {
    for (const g of this.glows) g.dispose();
    this.glows = [];
    for (const s of this.sprites) s.dispose();
    this.particles.dispose();
    for (const o of this.owned) o.dispose();
    this.sprites = [];
    this.owned = [];
  }
}

export { Z_DECAL, Z_SHADOW, Z_TOP, depth, snap, lerp, Squash };
