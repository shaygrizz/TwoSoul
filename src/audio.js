// Звуки: короткие эффекты (WebAudio) и непрерывный шум воды у берега.
// Файлы лежат в assets/sfx/*.wav (CC0, см. README), в офлайн-сборке они встроены в window.__EMBED.audio.
// Выстрел синтезируется кодом — готового свободного звука для него не нашлось.
import { CFG } from './config.js';
import { T, toTile } from './core/tilemap.js';

const NAMES = [
  'step_grass_1', 'step_grass_2', 'step_path_1', 'step_path_2', 'step_wet_1', 'step_wet_2',
  'chop_1', 'chop_2', 'chop_3', 'tree_crack', 'tree_land',
  'swing', 'whoosh', 'hit', 'kill', 'hurt', 'pickup', 'heal', 'switch', 'plate', 'door',
  'water_loop',
];

// Группы вариантов: один и тот же звук подряд быстро надоедает.
const GROUPS = {
  stepGrass: ['step_grass_1', 'step_grass_2'],
  stepPath: ['step_path_1', 'step_path_2'],
  stepWet: ['step_wet_1', 'step_wet_2'],
  chop: ['chop_1', 'chop_2', 'chop_3'],
};

const WATER_RANGE = 7;      // на каком расстоянии (в клетках) начинает слышаться вода
const HEAR_RANGE = 240;     // дальше этого расстояния (px) события вокруг не слышны
const STRIDE = 26;          // сколько пикселей между шагами при ходьбе
const STRIDE_SPRINT = 34;

const WATER_TILES = new Set([T.WATER, T.POOL]);

class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = new Map();
    this.last = new Map();       // имя звука → время последнего запуска (защита от «каши»)
    this.muted = readMuted();
    this.listener = { x: 0, y: 0 };
    this.stepDist = 0;
    this.water = { src: null, gain: null, level: 0, target: 0 };
    this.waterTick = 0;
    this.noise = null;
    this.loading = null;
    this.groanT = 1;
  }

  // Браузер разрешает звук только после касания/клика: вешаем разблокировку на первый жест.
  init() {
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) {
      window.addEventListener(ev, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    });
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (err) {
      console.warn('Звук недоступен:', err);
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : CFG.AUDIO.master;
    this.master.connect(this.ctx.destination);
    this.noise = makeNoise(this.ctx);
    this.loading = this.loadAll();
  }

  async loadAll() {
    await Promise.all(NAMES.map(async (name) => {
      try {
        const bytes = await fetchBytes(`assets/sfx/${name}.wav`);
        this.buffers.set(name, await decode(this.ctx, bytes));
      } catch (err) {
        console.warn('Не загрузился звук', name, err);
      }
    }));
    if (this.water.target > 0) this.startWater();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('vdvoem-muted', this.muted ? '1' : '0'); } catch { /* без сохранения тоже работает */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : CFG.AUDIO.master;
    return this.muted;
  }

  setListener(x, y) { this.listener.x = x; this.listener.y = y; }

  // Играет эффект. vol — громкость 0..1, rate — высота тона, jitter — случайный разброс высоты.
  play(name, { vol = 1, rate = 1, jitter = 0.06, minGap = 0.035 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const group = GROUPS[name];
    const id = group ? group[(Math.random() * group.length) | 0] : name;
    const buf = this.buffers.get(id);
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < minGap) return;
    this.last.set(name, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * jitter);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
  }

  // Выстрел из АК: всплеск шума с падающим фильтром + низкий «удар».
  gunshot(vol = 1) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    if (now - (this.last.get('gun') ?? -1) < 0.05) return;
    this.last.set('gun', now);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = 0.9 + Math.random() * 0.3;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, now);
    lp.frequency.exponentialRampToValueAtTime(500, now + 0.13);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.9 * vol, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(now); n.stop(now + 0.2);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(170, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.1);
    const og = c.createGain();
    og.gain.setValueAtTime(0.7 * vol, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    o.connect(og).connect(this.master);
    o.start(now); o.stop(now + 0.14);
  }

  // Рык зомби: низкий пильчатый тон, высота плывёт вниз, фильтр придушивает верха.
  groan(vol = 0.3) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    const f0 = 70 + Math.random() * 40;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, now);
    o.frequency.linearRampToValueAtTime(f0 * 0.6, now + 0.7);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(380, now);
    lp.frequency.linearRampToValueAtTime(200, now + 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    o.connect(lp).connect(g).connect(this.master);
    o.start(now); o.stop(now + 0.8);
  }

  // Время от времени рычит ближайший зомби: чем ближе, тем громче. Дальше 150 px не слышно.
  tickZombies(world, dt) {
    this.groanT -= dt;
    if (this.groanT > 0) return;
    this.groanT = 1 + Math.random() * 1.8;
    let best = Infinity;
    for (const m of world.mobs) {
      if (m.type !== 'zombie' || !m.alive) continue;
      const d = Math.hypot(m.x - this.listener.x, m.y - this.listener.y);
      if (d < best) best = d;
    }
    if (best < 150) this.groan(0.32 * (1 - best / 150) + 0.04);
  }

  startWater() {
    const w = this.water;
    const buf = this.buffers.get('water_loop');
    if (w.src || !buf || !this.ctx) return;
    w.gain = this.ctx.createGain();
    w.gain.gain.value = 0;
    w.src = this.ctx.createBufferSource();
    w.src.buffer = buf;
    w.src.loop = true;
    w.src.connect(w.gain).connect(this.master);
    w.src.start();
  }

  // Каждый кадр: плавно подводит громкость воды к целевой. Громкость растёт при приближении к воде.
  tickWater(dt, map, x, y, active) {
    const w = this.water;
    this.waterTick -= dt;
    if (!active || !map) w.target = 0;
    else if (this.waterTick <= 0) {
      this.waterTick = 0.1;
      const d = nearestWater(map, x, y);
      const k = d === null ? 0 : Math.max(0, 1 - d / (WATER_RANGE * CFG.TILE));
      w.target = k * k * CFG.AUDIO.water;
    }
    w.level += (w.target - w.level) * Math.min(1, dt * 4);
    if (w.level < 0.002 && w.target === 0) w.level = 0;
    if (w.level > 0 && !w.src) this.startWater();
    if (w.gain) w.gain.gain.value = w.level;
  }

  // Шаги по пройденному пути: на дорожке гулко, у воды хлюпают, на траве мягко.
  tickSteps(hero, map, ownerActive = true) {
    const dx = hero.x - hero.px, dy = hero.y - hero.py;
    const moving = ownerActive && hero.z === 0 && !hero.dead && hero.dashT <= 0 && Math.hypot(hero.vx, hero.vy) > 12;
    if (!moving) { this.stepDist = STRIDE * 0.6; return; } // первый шаг звучит почти сразу
    this.stepDist += Math.hypot(dx, dy);
    const stride = hero.sprint ? STRIDE_SPRINT : STRIDE;
    if (this.stepDist < stride) return;
    this.stepDist -= stride;
    const tx = toTile(hero.x), ty = toTile(hero.y);
    const t = map.terrainAt(tx, ty);
    let kind = 'stepGrass';
    if (t === T.PATH) kind = 'stepPath';
    else if (t === T.FLOOR) kind = 'stepPath';
    else if (nearestWater(map, hero.x, hero.y, 1) !== null) kind = 'stepWet';
    this.play(kind, { vol: hero.sprint ? 0.5 : 0.4, jitter: 0.1 });
  }

  // Событие игры → звук. own — вид героя, которым играем (в испытании ходят двое).
  event(e, own) {
    if (e.kind && own && e.kind !== own) return;
    let vol = 1;
    if (e.x !== undefined && !e.kind) {
      const d = Math.hypot(e.x - this.listener.x, e.y - this.listener.y);
      if (d > HEAR_RANGE) return;
      vol = 1 - (d / HEAR_RANGE) * 0.8;
    }
    switch (e.type) {
      case 'shoot': this.gunshot(0.55); break;
      case 'swing': this.play('swing', { vol: 0.6, rate: 0.95 }); break;
      case 'chop': this.play('chop', { vol: 0.95 * vol, jitter: 0.08 }); break;
      case 'treeFall': this.play('tree_crack', { vol: 0.8 * vol }); break;
      case 'treeLand': this.play('tree_land', { vol: 0.9 * vol, rate: 0.9 }); break;
      case 'treeGrow': this.play('heal', { vol: 0.25 * vol, rate: 1.5 }); break;
      case 'hit': this.play('hit', { vol: 0.8 * vol }); break;
      // Орда: звуки тише и ниже, иначе очередь по толпе превращается в кашу.
      case 'zhit': this.play('hit', { vol: 0.35 * vol, rate: 0.8, minGap: 0.05 }); break;
      case 'zkill': this.play('kill', { vol: 0.5 * vol, rate: 0.7, minGap: 0.07 }); break;
      case 'zcollapse': this.play('kill', { vol: 0.22 * vol, rate: 0.55, minGap: 0.09 }); break;
      case 'kingDown':
        this.play('tree_land', { vol: 1, rate: 0.7 });
        this.groan(0.5);
        setTimeout(() => this.play('heal', { vol: 0.9 }), 300);
        setTimeout(() => this.play('pickup', { vol: 0.8, rate: 1.3 }), 520);
        break;
      case 'kill': this.play('kill', { vol: 0.9 * vol }); break;
      case 'heroHurt': this.play('hurt', { vol: 0.9 }); break;
      case 'heroDown': this.play('hurt', { vol: 1, rate: 0.7 }); break;
      case 'jump': this.play('whoosh', { vol: 0.3, rate: 1.5 }); break;
      case 'land': this.play('stepGrass', { vol: 0.55, rate: 0.75 }); break;
      case 'dash': this.play('whoosh', { vol: 0.6, rate: 1.1 }); break;
      case 'respawn': this.play('whoosh', { vol: 0.5, rate: 1.3 }); break;
      case 'woodGet': this.play('pickup', { vol: 0.7 }); break;
      case 'heal': this.play('heal', { vol: 0.8 }); break;
      case 'switch': this.play('switch', { vol: 0.8 }); break;
      case 'gate': this.play('door', { vol: 0.8 }); break;
      // Испытание.
      case 'plateDown': this.play('plate', { vol: 0.8 }); break;
      case 'plateUp': this.play('plate', { vol: 0.5, rate: 0.8 }); break;
      case 'doorOpen': this.play('door', { vol: 0.8, rate: 1.05 }); break;
      case 'doorClose': this.play('door', { vol: 0.8, rate: 0.85 }); break;
      case 'gem': this.play('pickup', { vol: 0.75, rate: e.element === 'fire' ? 1.25 : 1.0 }); break;
      case 'trialDeath': this.play('hurt', { vol: 0.9, rate: 0.85 }); break;
      case 'win':
        this.play('heal', { vol: 0.9 });
        setTimeout(() => this.play('pickup', { vol: 0.8, rate: 1.3 }), 220);
        setTimeout(() => this.play('heal', { vol: 0.8, rate: 1.25 }), 440);
        break;
      default: break;
    }
  }
}

// Расстояние (px) до ближайшей клетки воды в радиусе r клеток или null.
function nearestWater(map, x, y, r = WATER_RANGE) {
  const cx = toTile(x), cy = toTile(y);
  let best = Infinity;
  for (let ty = cy - r; ty <= cy + r; ty++) {
    for (let tx = cx - r; tx <= cx + r; tx++) {
      if (!WATER_TILES.has(map.terrainAt(tx, ty))) continue;
      // Расстояние до ближайшей точки клетки, а не до её центра: у берега звук сразу полный.
      const nx = Math.max(tx * CFG.TILE, Math.min(x, (tx + 1) * CFG.TILE));
      const ny = Math.max(ty * CFG.TILE, Math.min(y, (ty + 1) * CFG.TILE));
      const d = Math.hypot(x - nx, y - ny);
      if (d < best) best = d;
    }
  }
  return best === Infinity ? null : best;
}

function makeNoise(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

async function fetchBytes(url) {
  const e = window.__EMBED;
  if (e?.audio?.[url]) {
    const bin = atob(e.audio[url]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const res = await fetch(`${url}?v=${CFG.ASSET_VERSION}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.arrayBuffer();
}

// Старые Safari знают только вариант decodeAudioData с колбэками.
function decode(ctx, bytes) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, reject);
    if (p?.catch) p.catch(reject);
  });
}

function readMuted() {
  try { return localStorage.getItem('vdvoem-muted') === '1'; } catch { return false; }
}

export const audio = new Audio();
