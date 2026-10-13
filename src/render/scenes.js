// Сцены мира и испытания: связывают состояние логики со спрайтами и частицами.
// alpha — доля между двумя шагами логики: позиции интерполируются, поэтому движение плавное
// при любой частоте экрана.
import { MapScene, Z_DECAL, Z_SHADOW, Z_TOP, lerp, Squash, treeSprite } from './view.js';
import { CFG } from '../config.js';
import { T } from '../core/tilemap.js';

const MOB_COLORS = { slime: ['#5cc27a', '#8be39b', '#d7ffe0'], bat: ['#6b4590', '#b48ad8'], mushroom: ['#d4423a', '#ffffff', '#f3e2c4'],
  zombie: ['#7fae4a', '#4e7a2f', '#b9d98a'], king: ['#ffd451', '#a26cff', '#7fae4a'] };
const TRAIL = { bulletAk: ['#ffd451', '#ff9a2e'], spore: ['#a374c7'] };
const SPARK = { bulletAk: ['#fff3b0', '#ffb43a', '#ffffff'], spore: ['#a374c7', '#d4b0f0'] };
const CHIPS = ['#e8c08a', '#c48a52', '#8a5a33', '#f3dcb0'];
const LEAVES = { naTree: ['#8cc63f', '#6aa52e', '#b5e06a'], naPinkTree: ['#f6a5a0', '#e57f7a', '#ffd0c8'], naBigTree: ['#4a9a4a', '#2f7a3a', '#7cc85a'], naPine: ['#3f8f4f', '#2d7440', '#5aa962'] };
const easeIn = (t) => t * t;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length) % arr.length]; }

function burst(ps, x, y, z, n, colors, speed = 40, life = 0.5, size = 1, g = 120) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.6);
    ps.spawn(x, y, z, Math.cos(a) * v, Math.sin(a) * v * 0.6, 20 + Math.random() * speed, life * (0.6 + Math.random() * 0.6), pick(colors), size, g);
  }
}

// Искры по направлению удара (dx, dy — направление пули на земле).
function sparks(ps, x, y, z, n, colors, dx, dy, speed = 70) {
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.6;
    const v = speed * (0.5 + Math.random() * 0.7);
    ps.spawn(x, y, z, Math.cos(a) * v, Math.sin(a) * v, 10 + Math.random() * 40, 0.25 + Math.random() * 0.2, pick(colors), 1, 200);
  }
}

const easeOutBack = (t) => { const c = 1.7; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

export class OverworldScene extends MapScene {
  constructor(view, world) {
    super(view, world.map, 'overworld');
    this.world = world;
    this.heroV = this.heroView(world.hero);

    const MOB_GLOW = { slime: [0x7dffb0, 26, 0.32], bat: [0xff5fc8, 18, 0.35], mushroom: [0x8ff4ff, 30, 0.3] };
    this.mobViews = world.mobs.map((m) => (m.type === 'zombie' || m.type === 'king'
      // Орда: свой лист спрайтов, без свечения (их много, телефону так легче).
      ? { horde: true, spr: this.zombieSprite(), shadow: this.shadowSprite(), sq: new Squash(), glow: null,
        wasAlive: m.alive, deathT: 0, spawnT: 1, view: 'front', phase: 0 }
      : {
        spr: this.flashSprite(), shadow: this.shadowSprite(), sq: new Squash(), glow: this.glow(...MOB_GLOW[m.type]),
        wasAlive: m.alive, deathT: 0, spawnT: 1, prevZ: m.z, prevShootT: 0, dx: 0, dy: 0,
      }));
    this.projViews = world.projectiles.map(() => ({ spr: this.atlasSprite(), shadow: this.shadowSprite(), glow: this.glow(0xffffff, 16, 0.55) }));
    this.pickViews = world.pickups.map(() => ({ spr: this.atlasSprite(), shadow: this.shadowSprite(), glow: this.glow(0xff6f9c, 20, 0.45) }));
    this.treeViews = world.trees.map((t) => {
      const v = { spr: this.flashSprite(), stump: this.atlasSprite(), shadow: this.shadowSprite(), sq: new Squash(),
        name: treeSprite(t.obj), state: t.state, growT: 1, flash: 0 };
      v.spr.frame(this.rect(v.name));
      // Крона становится полупрозрачной, когда герой за деревом.
      v.spr.mat.transparent = true;
      v.spr.mat.alphaTest = 0.3;
      v.fade = 1;
      v.stump.frame(this.rect('naStump'));
      v.stump.place(t.x, t.y + 1);
      return v;
    });
    // Портал светится двумя цветами.
    this.gateGlowF = this.glow(0xff8a3a, 46, 0.35);
    this.gateGlowW = this.glow(0x4aa3ff, 46, 0.35);
    this.cross = this.atlasSprite();
    this.cross.frame(this.rect('crosshair'));
    this.cross.show(false);
    this.aim = null;      // точка прицела в мире (мышь), задаёт main
    this.sparkT = 0;
    this.t = 0;
    this.hideHero = false;
  }

  sync(dt, alpha = 1) {
    const w = this.world;
    this.t += dt;
    this.tick(dt);

    const hv = this.heroV;
    if (this.hideHero) {
      for (const s of [hv.spr, hv.shadow, hv.gun, hv.muzzle]) s?.show(false);
    } else this.drawHero(hv, w.hero, alpha, dt);

    w.mobs.forEach((m, i) => this.drawMob(m, this.mobViews[i], alpha, dt));
    w.projectiles.forEach((p, i) => this.drawProjectile(p, this.projViews[i], alpha));

    w.trees.forEach((t, i) => this.drawTree(t, this.treeViews[i], alpha, dt));

    w.pickups.forEach((k, i) => {
      const v = this.pickViews[i];
      const life = k.kind === 'wood' ? 40 : 15;
      const vis = k.active && !(k.t > life - 3 && Math.floor(k.t * 8) % 2 === 0);
      const wood = k.kind === 'wood';
      v.spr.show(vis); v.shadow.show(k.active); v.glow.show(vis && !wood);
      if (!k.active) return;
      const x = lerp(k.px ?? k.x, k.x, alpha), y = lerp(k.py ?? k.y, k.y, alpha);
      // Полено выпрыгивает из-под дерева, потом лежит и чуть покачивается.
      const hop = wood && k.t < 0.4 ? Math.sin((k.t / 0.4) * Math.PI) * 14 : 0;
      v.spr.frame(this.rect(wood ? 'naLogs' : 'heart'));
      const pulse = 1 + Math.sin(this.t * 6 + i) * (wood ? 0.04 : 0.08);
      v.spr.place(x, y, (wood ? 2 : 5) + hop + Math.sin(this.t * 4 + i) * (wood ? 0.8 : 2));
      v.spr.scale(pulse, pulse);
      v.shadow.place(x, y + 1, 0, Z_SHADOW);
      if (!wood) v.glow.place(x, y, 8 + Math.sin(this.t * 4 + i) * 2, 1 + Math.sin(this.t * 6) * 0.1);
    });

    if (this.aim && !this.hideHero) {
      this.cross.place(this.aim.x, this.aim.y, 0, Z_TOP);
      const s = 1 + hv.recoil * 0.35;
      this.cross.scale(s, s);
      this.cross.show(true);
    } else this.cross.show(false);

    const gp = 1 + Math.sin(this.t * 2.2) * 0.12;
    this.gateGlowF.place(w.gate.x - 6, w.gate.y + 9, 26, gp);
    this.gateGlowW.place(w.gate.x + 6, w.gate.y + 9, 26, 2 - gp);
    // Искры у портала.
    this.sparkT += dt;
    while (this.sparkT > 0.07) {
      this.sparkT -= 0.07;
      const left = Math.random() < 0.5;
      const gx = w.gate.x + (left ? -6 : 6) + (Math.random() - 0.5) * 10;
      this.particles.spawn(gx, w.gate.y + 7, 6 + Math.random() * 30, 0, 0, 10 + Math.random() * 10, 0.9,
        left ? pick(['#ff9a2e', '#ffd451']) : pick(['#5c9fe4', '#bfe6ff']), 1, 0);
    }
  }

  drawTree(t, v, alpha, dt) {
    v.sq.update(dt);
    v.flash = Math.max(0, v.flash - dt * 7);
    if (t.state === 'up' && v.state === 'stump') { v.growT = 0; }   // снова выросло
    v.state = t.state;
    v.growT = Math.min(1, v.growT + dt / 0.6);
    v.stump.show(t.state !== 'up');
    v.spr.mat.userData.flash.value = v.flash;
    if (t.state === 'stump') {
      v.spr.show(false);
      v.shadow.show(false);
      return;
    }
    v.spr.show(true);
    if (t.state === 'falling') {
      // Падение: поворот вокруг основания с ускорением, как у настоящего ствола.
      const p = Math.min(1, (t.fallT + alpha * CFG.STEP) / CFG.TREE.fallTime);
      v.spr.place(t.x, t.y);
      v.spr.rotate(-t.fallDir * (Math.PI / 2) * easeIn(p));
      v.spr.scale(1, 1);
      v.shadow.place(t.x + t.fallDir * 20 * p, t.y + 1, 0, Z_SHADOW);
      v.shadow.scale(2.6 * (1 - p * 0.3), 2.6);
      v.shadow.show(true);
      return;
    }
    // Герой за кроной — плавно делаем её прозрачной.
    const h = this.world.hero;
    const behind = Math.abs(h.x - t.x) < 30 && h.y < t.y - 1 && h.y > t.y - 62;
    v.fade += ((behind ? 0.45 : 1) - v.fade) * (1 - Math.exp(-dt * 10));
    v.spr.mat.opacity = v.fade;
    // Стоит: дрожит после удара, при росте пружинит из пня.
    const shake = Math.sin(this.t * 70) * t.shakeT * 6;
    const g = easeOutBack(v.growT);
    v.spr.place(t.x + shake, t.y);
    v.spr.rotate(shake * 0.004);
    v.spr.scale(v.sq.sx * g, v.sq.sy * g);
    v.shadow.place(t.x, t.y + 1, 0, Z_SHADOW);
    v.shadow.scale(2.6 * g, 2.6 * g);
    v.shadow.show(true);
  }

  // Зомби и король: четыре вида зомби, король крупнее и в короне. Анимация ходьбы идёт по пройденному пути.
  drawZombie(m, v, alpha, dt) {
    v.sq.update(dt);
    const def = CFG.MOBS[m.type];
    const big = def.scale || 1;
    if (m.alive && !v.wasAlive) { v.spawnT = 0; v.sq.hit(1, 1); }   // выползает из земли
    if (!m.alive && v.wasAlive && v.deathT <= 0) v.deathT = 0.14;
    v.wasAlive = m.alive;
    const x = lerp(m.px, m.x, alpha), y = lerp(m.py, m.y, alpha);
    if (!m.alive) {
      if (v.deathT > 0) {
        v.deathT -= dt;
        const k = (1 + (0.14 - v.deathT) * 3) * big;
        v.spr.scale(k, k * 0.85);
        v.spr.mat.userData.flash.value = 1;
        v.spr.show(true);
        v.shadow.show(false);
        if (v.deathT <= 0) v.spr.show(false);
      } else { v.spr.show(false); v.shadow.show(false); }
      return;
    }
    const speed = Math.hypot(m.vx, m.vy);
    if (speed > 3) {
      const ax = Math.abs(m.vx), ay = Math.abs(m.vy);
      if (v.view === 'side') { if (ay > ax * 1.4) v.view = m.vy < 0 ? 'back' : 'front'; }
      else if (ax > ay * 1.1) v.view = 'side';
      else v.view = m.vy < 0 ? 'back' : 'front';
      v.phase += dt * speed * 0.3;
    }
    const meta = this.view.zombieMeta;
    const frames = this.view.zombieRects[meta.variants[m.type === 'king' ? meta.variants.length - 1 : m.variant % (meta.variants.length - 1)]]['walk_' + v.view];
    const idx = speed > 3 ? Math.floor(v.phase) % frames.length : 0;
    v.spr.frame(frames[idx], v.view === 'side' && m.facing < 0);
    v.spawnT = Math.min(1, v.spawnT + dt / 0.5);
    const grow = easeOutBack(v.spawnT);
    v.spr.place(x, y, 0);
    v.spr.scale(v.sq.sx * big, v.sq.sy * big * grow);
    // Рассыпающийся зомби мигает белым.
    const flash = m.collapseT > 0 ? (Math.sin(m.t * 45) > 0 ? 0.8 : 0) : Math.min(1, m.flash / 0.1);
    v.spr.mat.userData.flash.value = flash;
    v.spr.show(true);
    v.shadow.place(x, y + 1, 0, Z_SHADOW);
    v.shadow.scale(big * Math.min(1, grow), big * Math.min(1, grow));
    v.shadow.show(true);
  }

  drawMob(m, v, alpha, dt) {
    if (v.horde) { this.drawZombie(m, v, alpha, dt); return; }
    v.sq.update(dt);
    // Появление: мягко «выпрыгивает» из земли.
    if (m.alive && !v.wasAlive) { v.spawnT = 0; v.sq.hit(1, 1); }
    if (!m.alive && v.wasAlive && v.deathT <= 0) v.deathT = 0.12;
    v.wasAlive = m.alive;

    const x = lerp(m.px, m.x, alpha), y = lerp(m.py, m.y, alpha), z = lerp(m.pz, m.z, alpha);
    if (!m.alive) {
      // Короткая белая «вспышка-лопание» перед исчезновением.
      if (v.deathT > 0) {
        v.deathT -= dt;
        const k = 1 + (0.12 - v.deathT) * 4;
        v.spr.scale(k, k * 0.9);
        v.spr.mat.userData.flash.value = 1;
        v.spr.show(true);
        v.shadow.show(false);
        if (v.deathT <= 0) v.spr.show(false);
      } else { v.spr.show(false); v.shadow.show(false); }
      v.glow.show(false);
      return;
    }

    let name;
    if (m.type === 'slime') {
      if (m.state === 'hop' && m.z > 0.5) name = m.hopT < m.hopDur * 0.55 ? 'slimeUp' : 'slime0';
      else if (v.landT > 0) name = 'slimeDown';
      else name = 'slime' + (Math.floor(m.t * 6) % 4);
      v.landT = Math.max(0, (v.landT || 0) - dt);
      if (v.prevZ <= 0.01 && m.z > 0.01) v.sq.hit(0.8, 1.25);      // толчок
      if (v.prevZ > 0.5 && m.z <= 0.01) { v.sq.hit(1.25, 0.78); v.landT = 0.08; } // приземление
    } else if (m.type === 'bat') {
      name = 'bat' + (Math.floor(m.t * 14) % 4);
    } else {
      name = m.shootT > 0.15 ? 'mushroomS0' : m.shootT > 0 ? 'mushroomS1' : 'mushroom' + (Math.floor(m.t * 4) % 4);
      if (m.shootT > v.prevShootT + 0.01) v.sq.hit(1.2, 0.82);
    }
    v.prevZ = m.z; v.prevShootT = m.shootT;

    v.spawnT = Math.min(1, v.spawnT + dt / 0.35);
    const grow = easeOutBack(v.spawnT);
    const breathe = m.type === 'bat' ? 1 : 1 + Math.sin(m.t * 4) * 0.03;
    v.spr.frame(this.rect(name), m.facing < 0);
    v.spr.place(x, y, z);
    v.spr.scale(v.sq.sx * grow / breathe, v.sq.sy * grow * breathe);
    v.spr.mat.userData.flash.value = Math.min(1, m.flash / 0.1);
    v.spr.show(true);
    const k = (1 - Math.min(0.5, z / 50)) * grow;
    v.shadow.place(x, y + 1, 0, Z_SHADOW);
    v.shadow.scale(k, k);
    v.shadow.show(true);
    const pulse = 0.85 + Math.sin(m.t * 3) * 0.15;
    v.glow.place(x, y, z + (m.type === 'bat' ? 0 : 7), grow * pulse);
    v.glow.alpha(1 + Math.min(1, m.flash / 0.1));
    v.glow.show(true);
  }

  drawProjectile(p, v, alpha) {
    v.spr.show(p.active); v.shadow.show(p.active); v.glow.show(p.active);
    if (!p.active) return;
    const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha);
    v.glow.mat.color.setHex(p.kind === 'bulletAk' ? 0xffb43a : 0xb07be0);
    v.glow.place(x, y, p.z, p.kind === 'spore' ? 0.9 : 1);
    v.spr.frame(this.rect(p.kind));
    v.spr.place(x, y, p.z);
    if (p.kind === 'spore') {
      v.spr.rotate(0);
      const s = 1 + Math.sin(p.age * 18) * 0.15;
      v.spr.scale(s, s);
    } else {
      v.spr.rotate(Math.atan2(-p.vy, p.vx));
      v.spr.scale(1, 1);
    }
    v.shadow.place(x, y + 1, 0, Z_SHADOW);
    v.shadow.scale(0.4, 0.4);
    const trail = TRAIL[p.kind];
    if (trail) {
      const l = Math.hypot(p.vx, p.vy) || 1;
      this.particles.spawn(x - (p.vx / l) * 5, y - (p.vy / l) * 5, p.z, 0, 0, 0, p.kind === 'spore' ? 0.3 : 0.08, pick(trail), 1, 0);
    }
  }

  event(e) {
    const ps = this.particles;
    const hv = this.heroV;
    switch (e.type) {
      case 'shoot': this.heroShot(hv); break;
      case 'hit': {
        sparks(ps, e.x, e.y, e.z, 6, ['#ffffff', '#ffe0e8', ...(MOB_COLORS[e.mob] || [])], e.dx || 0, e.dy || 0);
        const v = this.mobViews[e.idx];
        if (v) v.sq.hit(1.3, 0.75);
        break;
      }
      case 'zhit': {
        sparks(ps, e.x, e.y, e.z, 4, [...MOB_COLORS[e.mob], '#ffffff'], e.dx || 0, e.dy || 0);
        const zv = this.mobViews[e.idx];
        if (zv) zv.sq.hit(1.1, 0.9);
        break;
      }
      case 'zkill':
        burst(ps, e.x, e.y, e.z, 9, MOB_COLORS[e.mob], 55, 0.5, 2);
        break;
      case 'zcollapse':
        burst(ps, e.x, e.y, e.z, 7, MOB_COLORS.zombie, 40, 0.6, 2, 30);
        break;
      case 'kingDown':
        burst(ps, e.x, e.y, 24, 60, ['#ffd451', '#fff3b0', '#a26cff', '#7fae4a', '#ffffff'], 110, 1.3, 2, 60);
        break;
      case 'kill':
        burst(ps, e.x, e.y, e.z, 18, MOB_COLORS[e.mob] || ['#ffffff'], 70, 0.6, 2);
        sparks(ps, e.x, e.y, e.z, 8, ['#ffffff'], e.dx || 0, e.dy || 0, 100);
        break;
      case 'puff': sparks(ps, e.x, e.y, e.z, 5, SPARK[e.kind] || ['#ffffff'], 0, 0, 40); break;
      case 'heroHurt': hv.flash = 1; hv.sq.hit(1.25, 0.8); burst(ps, e.x, e.y, 20, 8, ['#ff4f7b', '#ffc2d2'], 50, 0.4); break;
      case 'heroDown': hv.flash = 1; burst(ps, e.x, e.y, 16, 20, ['#ff4f7b', '#ffc2d2', '#ffffff'], 70, 0.8, 2); break;
      case 'heal': for (let i = 0; i < 8; i++) ps.spawn(e.x + (Math.random() - 0.5) * 10, e.y, 6, 0, 0, 25 + Math.random() * 15, 0.7, pick(['#ff4f7b', '#ffc2d2']), 1, 0); break;
      case 'jump': hv.sq.hit(0.8, 1.22); burst(ps, e.x, e.y + 1, 0, 3, ['#d9c39c'], 20, 0.25, 1, 60); break;
      case 'land': hv.sq.hit(1.3, 0.72); burst(ps, e.x, e.y + 2, 0, 5, ['#c9a77c', '#76c25e'], 28, 0.3, 1, 60); break;
      case 'dash': hv.sq.hit(1.3, 0.8); burst(ps, e.x, e.y + 2, 1, 6, ['#ffffff', '#d8e8ff'], 35, 0.3, 1, 0); break;
      case 'respawn': hv.sq.hit(0.6, 1.4); burst(ps, e.x, e.y, 10, 18, ['#ffffff', '#ffd84a', '#ff9eb5'], 50, 0.7, 1, 0); break;
      case 'chop': {
        const tv = this.treeViews[e.idx];
        if (tv) { tv.sq.hit(1.08, 0.94); tv.flash = 0.6; }
        sparks(ps, e.x - (e.dx || 0) * 6, e.y, e.z, 9, CHIPS, -(e.dx || 0), 0.3, 80);
        burst(ps, e.x, e.y, 34 + Math.random() * 14, 6, LEAVES[tv?.name] || LEAVES.naTree, 30, 0.9, 1, 40);
        hv.sq.hit(1.12, 0.9);
        break;
      }
      case 'treeFall': burst(ps, e.x, e.y, 40, 14, LEAVES[this.treeViews[e.idx]?.name] || LEAVES.naTree, 45, 1.1, 1, 50); break;
      case 'treeLand':
        burst(ps, e.x, e.y + 2, 1, 22, ['#c9a77c', '#b08a5c', '#e2cfa8'], 60, 0.7, 2, 80);
        burst(ps, e.x, e.y, 6, 12, LEAVES[this.treeViews[e.idx]?.name] || LEAVES.naTree, 50, 0.9, 1, 60);
        break;
      case 'treeGrow': burst(ps, e.x, e.y, 20, 12, ['#b5e06a', '#ffffff', '#8cc63f'], 35, 0.7, 1, 0); break;
      case 'woodGet': hv.sq.hit(1.1, 0.92); burst(ps, e.x, e.y, 8, 6, ['#ffd27a', '#ffffff', '#e8c08a'], 30, 0.4, 1, 0); break;
      case 'switch': hv.sq.hit(0.92, 1.08); break;
      default: break;
    }
  }
}

export class TrialScene extends MapScene {
  constructor(view, state) {
    super(view, state.map, 'trial');
    this.state = state;
    this.heroViews = state.heroes.map((h) => {
      const v = this.heroView(h);
      v.icon = this.atlasSprite();
      v.icon.frame(this.rect(h.element === 'fire' ? 'iconFire' : 'iconWater'));
      return v;
    });
    this.marker = this.atlasSprite();
    this.marker.frame(this.rect('marker'));
    this.plateViews = state.plates.map((p) => {
      const s = this.atlasSprite();
      s.place((p.tx + 0.5) * CFG.TILE, (p.ty + 0.5) * CFG.TILE, 0, Z_DECAL);
      return s;
    });
    this.doorViews = state.doors.map((d) => d.tiles.map((t) => {
      const s = this.atlasSprite();
      s.place((t.tx + 0.5) * CFG.TILE, (t.ty + 0.5) * CFG.TILE, 0, Z_DECAL);
      return s;
    }));
    this.exitViews = {};
    for (const el of ['fire', 'water']) {
      const e = state.exits[el];
      const s = this.atlasSprite();
      s.place((e.tx + 0.5) * CFG.TILE, (e.ty + 0.5) * CFG.TILE, 0, Z_DECAL);
      this.exitViews[el] = s;
    }
    this.gemViews = state.gems.map((g) => {
      const spr = this.atlasSprite();
      spr.frame(this.rect(g.el === 'fire' ? 'gemFire' : 'gemWater'));
      const shadow = this.shadowSprite();
      shadow.place(g.x, g.y + 2, 0, Z_SHADOW);
      const glow = this.glow(g.el === 'fire' ? 0xff7a3a : 0x3aa0ff, 22, 0.45);
      return { spr, shadow, glow, taken: false, popT: 0 };
    });
    this.t = 0;
    this.auraT = 0;
    this.markerX = null;
  }

  sync(dt, alpha = 1) {
    const s = this.state;
    this.t += dt;
    this.tick(dt);

    s.heroes.forEach((h, i) => {
      const v = this.heroViews[i];
      this.drawHero(v, h, alpha, dt);
      const p = this.heroPos(h, alpha);
      v.icon.place(p.x, p.y + 0.2, p.z + 44 * v.sq.sy + Math.sin(this.t * 3 + i) * 1.2);
      v.icon.show(!h.dead);
      if (i === s.active && !s.won) {
        // Маркер «перелетает» к новому герою при смене, а не прыгает.
        const k = 1 - Math.exp(-dt * 14);
        if (this.markerX === null) { this.markerX = p.x; this.markerY = p.y; this.markerZ = p.z; }
        this.markerX += (p.x - this.markerX) * k;
        this.markerY += (p.y - this.markerY) * k;
        this.markerZ += (p.z - this.markerZ) * k;
        this.marker.place(this.markerX, this.markerY + 0.3, this.markerZ + 56 + Math.sin(this.t * 6) * 1.5);
        this.marker.show(!h.dead);
      }
    });
    if (s.won) this.marker.show(false);

    // Аура стихии.
    this.auraT += dt;
    while (this.auraT > 0.05) {
      this.auraT -= 0.05;
      for (const h of s.heroes) {
        if (h.dead) continue;
        const fire = h.element === 'fire';
        const px = h.x + (Math.random() - 0.5) * 14;
        if (fire) this.particles.spawn(px, h.y, h.z + Math.random() * 20, (Math.random() - 0.5) * 6, 0, 14 + Math.random() * 12, 0.6, pick(['#ff9a2e', '#ffd451', '#e8641f']), 1, 0);
        else this.particles.spawn(px, h.y, h.z + 8 + Math.random() * 20, 0, 0, 4, 0.6, pick(['#5c9fe4', '#bfe6ff', '#9ccff6']), 1, 60);
      }
    }

    s.plates.forEach((p, i) => this.plateViews[i].frame(this.rect(`plate${p.id}${p.pressed ? 'Down' : 'Up'}`)));
    s.doors.forEach((d, i) => {
      const stage = d.open < 0.33 ? 0 : d.open < 0.85 ? 1 : 2;
      for (const spr of this.doorViews[i]) spr.frame(this.rect(`door${d.id}_${stage}`));
    });
    for (const el of ['fire', 'water']) {
      const e = s.exits[el];
      const h = s.heroes.find((x) => x.element === el);
      const on = h && !h.dead && Math.floor(h.x / CFG.TILE) === e.tx && Math.floor(h.y / CFG.TILE) === e.ty;
      const pulse = Math.floor(this.t * 2) % 2 === 0;
      this.exitViews[el].frame(this.rect((el === 'fire' ? 'exitFire' : 'exitWater') + (on || pulse ? 1 : 0)));
    }
    s.gems.forEach((g, i) => {
      const v = this.gemViews[i];
      if (g.taken && !v.taken) { v.taken = true; v.popT = 0.18; }
      if (v.taken) {
        // Кристалл подпрыгивает и исчезает.
        v.popT -= dt;
        v.shadow.show(false);
        v.glow.show(v.popT > 0);
        if (v.popT > 0) {
          const k = 1 + (0.18 - v.popT) * 3;
          v.spr.place(g.x, g.y, 4 + (0.18 - v.popT) * 60);
          v.spr.scale(k, k);
        } else v.spr.show(false);
        return;
      }
      v.spr.place(g.x, g.y, 4 + Math.sin(this.t * 3 + i) * 2);
      v.spr.scale(1, 1);
      v.glow.place(g.x, g.y, 8 + Math.sin(this.t * 3 + i) * 2, 1 + Math.sin(this.t * 4 + i) * 0.12);
    });
  }

  event(e) {
    const ps = this.particles;
    const v = this.heroViews[this.state.heroes.findIndex((h) => h.kind === e.kind)];
    switch (e.type) {
      case 'trialDeath': {
        const colors = e.terrain === T.LAVA ? ['#ff9a2e', '#ffd451', '#3a3a3a'] : e.terrain === T.ACID ? ['#93e055', '#d4ff9a', '#3f8a22'] : ['#5c9fe4', '#e3f4ff', '#9ccff6'];
        burst(ps, e.x, e.y, 6, 22, colors, 60, 0.7, 2);
        if (v) { v.flash = 1; v.sq.hit(1.4, 0.6); }
        break;
      }
      case 'gem': burst(ps, e.x, e.y, e.z, 14, e.element === 'fire' ? ['#ffe0b0', '#ff5a2a', '#ffffff'] : ['#e0f4ff', '#3aa0ff', '#ffffff'], 45, 0.6, 1, 40); break;
      case 'plateDown': burst(ps, e.x, e.y + 4, 1, 6, ['#ffe27a', '#ffffff'], 25, 0.3, 1, 0); break;
      case 'doorOpen': case 'doorClose': burst(ps, e.x, e.y + 6, 2, 6, ['#a39e8d', '#787365'], 25, 0.4, 1, 80); break;
      case 'jump': if (v) v.sq.hit(0.8, 1.22); break;
      case 'land': if (v) v.sq.hit(1.3, 0.72); burst(ps, e.x, e.y + 2, 0, 4, ['#a39e8d'], 22, 0.25, 1, 60); break;
      case 'respawn':
        if (v) v.sq.hit(0.6, 1.4);
        burst(ps, e.x, e.y, 10, 16, e.element === 'fire' ? ['#ff9a2e', '#ffd451'] : ['#5c9fe4', '#bfe6ff'], 45, 0.6, 1, 0);
        break;
      case 'win':
        for (const [i, h] of this.state.heroes.entries()) {
          this.heroViews[i].sq.hit(0.7, 1.35);
          burst(ps, h.x, h.y, 30, 40, ['#ff4f7b', '#ffd451', '#5c9fe4', '#ffffff', '#ff9a2e'], 90, 1.4, 2, 90);
        }
        break;
      default: break;
    }
  }
}
