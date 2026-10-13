// Точка входа: загрузка, игровой цикл с фиксированным шагом, переходы между экранами.
import { CFG } from './config.js';
import { View } from './render/view.js';
import { OverworldScene, TrialScene } from './render/scenes.js';
import { createOverworld, updateOverworld, placeAtGate } from './core/overworld.js';
import { updateMob } from './core/mobs.js';
import { EMPTY_INPUT } from './core/hero.js';
import { T } from './core/tilemap.js';
import { fireWater, swapActive } from './trials/fireWater.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { loadSave, newSave, writeSave } from './save.js';
import { audio } from './audio.js';

const game = {
  mode: 'loading',     // title | world | trial
  save: null,
  pickedHero: 'her',
  world: null, worldScene: null,
  trial: null, trialScene: null,
  acc: 0, last: 0, saveT: 0, titleT: 0,
  cam: { x: 0, y: 0 },
  shake: { t: 0, kx: 0, ky: 0 },
  hitstop: 0,
  expr: { name: 'smile', t: 0 }, winkT: 4,
  superToasts: 0,       // сколько раз уже подсказали про суперудар
  victoryT: 0,         // обратный отсчёт до окна победы после смерти короля
};

let view, ui, input;

boot().catch((err) => {
  console.error(err);
  ui?.showLoadingError('Что-то пошло не так при загрузке. Обнови страницу.');
});

async function boot() {
  ui = new UI();
  const canvas = document.getElementById('game');
  try {
    view = new View(canvas);
  } catch (err) {
    console.error(err);
    ui.showLoadingError('Этот браузер не умеет WebGL, а без него игра не запустится. Попробуй другой браузер.');
    return;
  }
  view.resize();
  await Promise.all([view.load(), ui.load(), document.fonts?.ready]);
  ui.setHeroAtlas(view.heroMeta);
  ui.setWoodIcon(view.atlas.canvas, view.atlas.rects.naLogs);
  ui.setWeaponArt(view.weaponImg, view.weapons);

  audio.init();
  input = new Input({ canvas, touchRoot: document.getElementById('touch'), screenToWorld: (x, y) => view.screenToWorld(x, y) });
  ui.onWeaponSlot((i) => input.press('slot' + (i + 1)));
  if (window.matchMedia?.('(pointer: coarse)').matches) ui.setTouch(true);
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !document.body.classList.contains('touch')) {
      ui.setTouch(true);
      if (game.mode === 'world' || game.mode === 'trial') ui.showHUD(game.mode);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) ui.toast(audio.toggleMute() ? 'Звук выключен' : 'Звук включён', 1200);
  });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persist();
      input.reset();
      if ((game.mode === 'world' || game.mode === 'trial') && !ui.modalOpen) openPause();
    }
  });
  window.addEventListener('pagehide', persist);
  ui.onPause(() => { if (!ui.modalOpen && game.mode !== 'title') openPause(); });

  const { data, status } = loadSave();
  game.save = data;
  game.pickedHero = data ? data.hero : 'her';
  const note = status === 'corrupted' ? 'Сохранение было повреждено, поэтому начнём заново.'
    : status === 'unavailable' ? 'Браузер не даёт сохранять прогресс: играть можно, но без сохранений.' : '';
  enterTitle(note);
  ui.hideLoading();
  registerSW();
  game.last = performance.now();
  requestAnimationFrame(frame);
}

// ---------- экраны ----------
function enterTitle(note = '') {
  document.body.classList.remove('aiming');
  disposeTrial();
  game.worldScene?.dispose();
  game.world = createOverworld(game.pickedHero, null, { horde: false });   // на титульном экране орды нет
  game.worldScene = new OverworldScene(view, game.world);
  game.worldScene.hideHero = true;
  view.setScene(game.worldScene);
  game.mode = 'title';
  applyScale();
  ui.hideHUD();
  ui.showTitle({
    hero: game.pickedHero,
    hasSave: Boolean(game.save),
    note,
    onPick: (k) => { game.pickedHero = k; },
    onContinue: () => {
      game.save.hero = game.pickedHero;
      ui.transition(startGame);
    },
    onPlay: () => {
      if (!game.save) return startNew();
      ui.modal({
        title: 'Начать заново?',
        html: '<p>Текущий прогресс сотрётся.</p>',
        buttons: [
          { label: 'Да, заново', primary: true, onClick: startNew },
          { label: 'Отмена' },
        ],
      });
    },
  });
}

function startNew() {
  game.save = newSave(game.pickedHero);
  writeSave(game.save);
  ui.transition(startGame);
}

function startGame() {
  game.worldScene?.dispose();
  game.world = createOverworld(game.save.hero, game.save);
  game.worldScene = new OverworldScene(view, game.world);
  view.setScene(game.worldScene);
  game.mode = 'world';
  game.acc = 0;
  input.reset();
  applyScale();
  snapCamera();
  ui.hideTitle();
  ui.showHUD('world');
  ui.setHeartsVisible(true);
  ui.setSub('');
  game.victoryT = 0;
  // Один раз за сеанс подсказываем, как бежать на телефоне.
  if (!game.runHinted) {
    game.runHinted = true;
    setTimeout(() => {
      if (document.body.classList.contains('touch') && game.mode === 'world' && !ui.modalOpen) ui.toast('Тяни стик до острых концов, и герой побежит', 3600);
    }, 6000);
  }
  persist();
  if (!game.world.kingDead) ui.toast('Орда зомби! Убей короля в короне, и все рассыплются', 4200);
  else if (!game.save.trials.fireWater.done) ui.toast('Испытание ждёт у ворот на северо-востоке', 3200);
}

function openGateModal() {
  const fw = game.save.trials.fireWater;
  const best = fw.done && fw.bestTime ? `<p>Лучшее время: ${formatTime(fw.bestTime)}</p>` : '';
  ui.modal({
    title: fw.done ? 'Огонь и вода ✓' : 'Испытание: Огонь и вода',
    html: `<p><span class="el-fire">Огонь</span> проходит по лаве, <span class="el-water">вода</span> — по воде. <span class="el-acid">Кислоту</span> можно только перепрыгнуть.</p>
      <p>Плиты открывают решётки, пока на них кто-то стоит. Приведите обоих к своим выходам.</p>
      <p>Играешь один? Переключайся между героями кнопкой ⇄ ${document.body.classList.contains('touch') ? '' : '(или Q)'}.</p>${best}`,
    buttons: [
      { label: fw.done ? 'Пройти ещё раз' : 'Начать', primary: true, onClick: () => ui.transition(enterTrial) },
      { label: 'Позже' },
    ],
  });
}

function enterTrial() {
  document.body.classList.remove('aiming');
  persist();
  game.trial = fireWater.start({ playerKind: game.save.hero });
  game.trialScene = new TrialScene(view, game.trial);
  view.setScene(game.trialScene);
  game.mode = 'trial';
  game.acc = 0;
  input.reset();
  applyScale();
  ui.showHUD('trial');
  ui.setKingIndicator(false);
  ui.setHeartsVisible(false);
  ui.hideInventory();
  ui.toast(`Ты — ${heroLabel(game.trial.heroes[game.trial.active])}`, 2200);
}

function completeTrial() {
  const r = fireWater.finish(game.trial);
  const fw = game.save.trials.fireWater;
  const first = !fw.done;
  fw.done = true;
  fw.bestTime = fw.bestTime ? Math.min(fw.bestTime, r.time) : r.time;
  fw.gems = Math.max(fw.gems, r.gems);
  persist();
  const fire = game.trial.gems.filter((g) => g.el === 'fire' && g.taken).length;
  const water = game.trial.gems.filter((g) => g.el === 'water' && g.taken).length;
  ui.modal({
    title: 'Испытание пройдено!',
    html: `<p>Время: <b>${formatTime(r.time)}</b></p>
      <p>Кристаллы: <span class="el-fire">${fire}</span> + <span class="el-water">${water}</span> из ${r.totalGems}</p>
      <p>${first ? 'Огонь и вода — отличная команда ❤' : 'Ещё быстрее, чем в прошлый раз? Посмотрим ❤'}</p>`,
    buttons: [{ label: 'Вернуться в мир', primary: true, onClick: () => ui.transition(exitTrial) }],
  });
}

function exitTrial() {
  disposeTrial();
  game.mode = 'world';
  view.setScene(game.worldScene);
  placeAtGate(game.world);
  game.acc = 0;
  input.reset();
  applyScale();
  snapCamera();
  ui.showHUD('world');
  ui.setHeartsVisible(true);
  ui.setSub('');
  persist();
}

function restartTrial() {
  disposeTrial();
  enterTrial();
}

function disposeTrial() {
  game.trialScene?.dispose();
  game.trialScene = null;
  game.trial = null;
}

function openPause() {
  persist();
  input.reset();
  const buttons = [{ label: 'Продолжить', primary: true }];
  if (game.mode === 'trial') {
    buttons.push({ label: 'Начать испытание заново', onClick: () => ui.transition(restartTrial) });
    buttons.push({ label: 'Выйти из испытания', onClick: () => ui.transition(exitTrial) });
  } else {
    buttons.push({ label: 'В главное меню', onClick: () => { persist(); ui.transition(() => enterTitle()); } });
  }
  ui.modal({ title: 'Пауза', html: '', buttons });
}

// ---------- цикл ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, Math.max(0, (now - game.last) / 1000));
  game.last = now;

  if (game.mode === 'title') {
    titleTick(dt);
  } else if (game.mode === 'world' || game.mode === 'trial') {
    if (ui.modalOpen || document.hidden) {
      game.acc = 0;
      input.sample(); // нажатия во время паузы не копятся
    } else if (game.hitstop > 0) {
      // Короткая заморозка при убийстве: удар ощущается весомее.
      game.hitstop = Math.max(0, game.hitstop - dt);
    } else {
      game.acc += dt;
      let steps = 0;
      while (game.acc >= CFG.STEP && steps < CFG.MAX_STEPS) {
        const inp = input.sample();
        if (game.mode === 'world') stepWorld(inp);
        else if (game.mode === 'trial') stepTrial(inp);
        game.acc -= CFG.STEP;
        steps++;
        if (ui.modalOpen || game.hitstop > 0) break;
      }
      if (steps === CFG.MAX_STEPS) game.acc = 0;
    }
    const live = ui.modalOpen ? 0 : dt;
    // Доля пути до следующего шага логики: по ней интерполируются позиции.
    const alpha = Math.min(1, Math.max(0, game.acc / CFG.STEP));
    if (game.mode === 'world') renderWorld(dt, live, alpha);
    else if (game.mode === 'trial') renderTrial(dt, live, alpha);
    // Вода шумит только во время игры: на паузе и в меню — тишина.
    const h = game.mode === 'world' ? game.world.hero : game.trial?.heroes[game.trial.active];
    const map = game.mode === 'world' ? game.world.map : game.trial?.map;
    audio.tickWater(dt, map, h?.x, h?.y, Boolean(h) && !ui.modalOpen);
  } else {
    audio.tickWater(dt, null, 0, 0, false);
  }
  view.render();
}

function stepWorld(inp) {
  if (inp.pause) { openPause(); return; }
  const w = game.world;
  w.view = view.halfExtent();   // орда появляется за краем экрана
  updateOverworld(w, inp, CFG.STEP);
  audio.setListener(w.hero.x, w.hero.y);
  audio.tickSteps(w.hero, w.map);
  audio.tickZombies(w, CFG.STEP);
  for (const e of w.events) {
    game.worldScene.event(e);
    audio.event(e);
    switch (e.type) {
      case 'gate': openGateModal(); break;
      case 'shoot': addShake(CFG.FEEL.shake.shoot, e.dx, e.dy); break;
      case 'heroHurt': setExpr('hurt', 0.6); addShake(CFG.FEEL.shake.hurt); break;
      case 'heroDown': setExpr('hurt', 1.5); addShake(CFG.FEEL.shake.hurt); ui.toast('Ой! Возвращаемся домой…'); break;
      case 'kill': setExpr('happy', 0.8); addShake(CFG.FEEL.shake.kill); game.hitstop = CFG.FEEL.hitStop; break;
      case 'heal': setExpr('happy', 0.8); persist(); break;
      case 'super': setExpr('happy', 0.9); addShake(5); break;
      case 'superReady':
        if (game.superToasts++ < 3) ui.toast(document.body.classList.contains('touch') ? 'Суперудар готов! Жми кнопку со звездой' : 'Суперудар готов! Нажми F', 2000);
        break;
      case 'zkill': addShake(0.5); break;   // зомби много: без заморозки кадра и смены лица
      case 'kingDown':
        setExpr('happy', 3); addShake(6);
        game.save.kingDead = true; persist();
        ui.toast('Король пал! Орда рассыпается…', 3000);
        game.victoryT = 3;
        break;
      case 'chop': addShake(0.9, e.dx, 0); game.hitstop = Math.max(game.hitstop, 0.03); break;
      case 'treeLand': addShake(2.4); break;
      case 'woodGet': setExpr('happy', 0.5); break;
      case 'switch': break; // название видно в окне оружия сверху
      case 'respawn': persist(); break;
      default: break;
    }
  }
  w.events.length = 0;
  if (game.victoryT > 0 && (game.victoryT -= CFG.STEP) <= 0) {
    ui.modal({
      title: 'Король пал!',
      html: '<p>Корона упала, и вся орда рассыпалась в прах.</p><p>Теперь можно спокойно гулять и рубить деревья ❤</p>',
      buttons: [{ label: 'Продолжить', primary: true }],
    });
  }
  game.saveT += CFG.STEP;
  if (game.saveT > 20) { game.saveT = 0; persist(); }
}

function stepTrial(inp) {
  if (inp.pause) { openPause(); return; }
  const s = game.trial;
  if (inp.swap && !s.won) {
    swapActive(s);
    ui.toast(`Теперь ты — ${heroLabel(s.heroes[s.active])}`, 1200);
  }
  const inputs = s.heroes.map((_, i) => (i === s.active ? inp : EMPTY_INPUT));
  fireWater.update(s, inputs, CFG.STEP);
  const own = s.heroes[s.active];
  audio.setListener(own.x, own.y);
  audio.tickSteps(own, s.map);
  for (const e of s.events) {
    game.trialScene.event(e);
    audio.event(e, own.kind);
    if (e.type === 'trialDeath') {
      const own = s.heroes[s.active];
      if (e.kind === own.kind) setExpr('hurt', 0.8);
      ui.toast(deathText(e), 1600);
    } else if (e.type === 'gem') setExpr('happy', 0.6);
    else if (e.type === 'win') { setExpr('happy', 3); ui.toast('Получилось!', 1800); }
  }
  s.events.length = 0;
  if (s.done) completeTrial();
}

function renderWorld(dt, live, alpha) {
  const h = game.world.hero;
  const scene = game.worldScene;
  // Прицел: курсор мыши или точка перед героем по направлению сенсорного прицела.
  let aim = input.aimWorld();
  document.body.classList.toggle('aiming', Boolean(aim));
  const dir = input.aimDir();
  if (!aim && dir) {
    const hp = scene.heroPos(h, alpha);
    aim = { x: hp.x + dir.x * 46, y: hp.y + dir.y * 46 };
  }
  scene.aim = aim;
  // Камера: интерполированный герой + упреждение по скорости + немного к прицелу.
  const p = scene.heroPos(h, alpha);
  const F = CFG.FEEL;
  let tx = p.x + h.vx * F.camLead, ty = p.y - 14 + h.vy * F.camLead;
  if (aim) {
    const ax = (aim.x - p.x) * F.camAimLead, ay = (aim.y - p.y) * F.camAimLead;
    const l = Math.hypot(ax, ay);
    const k = l > F.camAimMax ? F.camAimMax / l : 1;
    tx += ax * k; ty += ay * k;
  }
  followCamera(tx, ty, live, game.world.map);
  scene.sync(live, alpha);
  updateKingHud(game.world);
  ui.setSuper(game.world.super.charge, CFG.SUPER.kills);
  ui.setHearts(h.hp, CFG.HERO.maxHp);
  ui.setInventory(h.weapons, h.gun, game.world.wood);
  ui.setPortrait(h.kind, currentExpr(dt, h.hp <= 1));
}

// Король убегает, а карта больше экрана: у края экрана показываем стрелку в его сторону, в подписи — его здоровье.
function updateKingHud(w) {
  const k = w.king;
  if (!k || !k.alive) { ui.setKingIndicator(false); ui.setSub(''); return; }
  ui.setSub('Король ' + Math.ceil(k.hp) + '/' + CFG.MOBS.king.hp);
  const e = view.halfExtent();
  const dx = k.x - game.cam.x, dy = k.y - 10 - game.cam.y;
  if (Math.abs(dx) < e.hw - 10 && Math.abs(dy) < e.hh - 10) { ui.setKingIndicator(false); return; }
  // Точка на краю экрана (в CSS-пикселях) по лучу от центра к королю.
  const css = view.scale / view.dpr;
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const px = dx * css, py = dy * css;
  const margin = 46, top = 120;   // сверху ниже HUD
  const t = Math.min((cx - margin) / (Math.abs(px) || 1e-6), (cy - (px === 0 && py < 0 ? top : margin)) / (Math.abs(py) || 1e-6));
  let x = cx + px * t, y = cy + py * t;
  y = Math.max(top, Math.min(window.innerHeight - margin, y));
  ui.setKingIndicator(true, x, y, Math.atan2(py, px));
}

function renderTrial(dt, live, alpha) {
  const s = game.trial;
  const h = s.heroes[s.active];
  const p = game.trialScene.heroPos(h, alpha);
  followCamera(p.x, p.y - 14, live, s.map);
  game.trialScene.sync(live, alpha);
  ui.setPortrait(h.kind, currentExpr(dt, false));
  ui.setSub(heroLabel(h));
  const count = (el, taken) => s.gems.filter((g) => g.el === el && (!taken || g.taken)).length;
  ui.setTrialHud({ time: s.time, fire: count('fire', true), fireTotal: count('fire'), water: count('water', true), waterTotal: count('water') });
}

function titleTick(dt) {
  const w = game.world;
  game.titleT += dt;
  const ctx = { target: null, blocked: w.blocked, rnd: w.rnd, map: w.map, spawnSpore() {} };
  for (const m of w.mobs) updateMob(m, dt, ctx);
  const t = game.titleT;
  const x = w.map.pxW * 0.5 + Math.sin(t * 0.06) * w.map.pxW * 0.28;
  const y = w.map.pxH * 0.5 + Math.sin(t * 0.045 + 1) * w.map.pxH * 0.22;
  view.lookAt(x, y, w.map.pxW, w.map.pxH);
  game.worldScene.sync(dt);
  ui.tickTitle(dt);
}

// ---------- камера и масштаб ----------
function applyScale() {
  if (game.mode === 'trial' && game.trial) view.setScaleFor('fit', game.trial.map.pxW, game.trial.map.pxH);
  else view.setScaleFor('follow');
}

function snapCamera() {
  const h = game.world.hero;
  game.cam.x = h.x; game.cam.y = h.y - 14;
  view.lookAt(game.cam.x, game.cam.y, game.world.map.pxW, game.world.map.pxH);
}

function followCamera(tx, ty, dt, map) {
  // Экспоненциальное сглаживание не зависит от частоты кадров.
  const k = 1 - Math.exp(-dt * CFG.FEEL.camFollow);
  game.cam.x += (tx - game.cam.x) * k;
  game.cam.y += (ty - game.cam.y) * k;
  if (!Number.isFinite(game.cam.x) || !Number.isFinite(game.cam.y)) { game.cam.x = tx; game.cam.y = ty; }
  // Тряска: затухает сама, направленная часть толкает камеру против выстрела.
  const sh = game.shake;
  sh.t = Math.max(0, sh.t * Math.exp(-dt * 14));
  sh.kx *= Math.exp(-dt * 20); sh.ky *= Math.exp(-dt * 20);
  const ox = (Math.random() - 0.5) * 2 * sh.t + sh.kx;
  const oy = (Math.random() - 0.5) * 2 * sh.t + sh.ky;
  view.lookAt(game.cam.x + ox, game.cam.y + oy, map.pxW, map.pxH);
}

function addShake(amount, dx = 0, dy = 0) {
  game.shake.t = Math.min(6, game.shake.t + amount);
  game.shake.kx -= (dx || 0) * amount * 1.5;
  game.shake.ky -= (dy || 0) * amount * 1.5;
}

function onResize() {
  view.resize();
  applyScale();
}

// ---------- мелочи ----------
function setExpr(name, t) { game.expr.name = name; game.expr.t = t; }

function currentExpr(dt, lowHp) {
  if (game.expr.t > 0) { game.expr.t -= dt; return game.expr.name; }
  game.winkT -= dt;
  if (game.winkT < 0) { if (game.winkT < -0.35) game.winkT = 5 + Math.random() * 4; return 'wink'; }
  return lowHp ? 'surprised' : 'smile';
}

function heroLabel(h) {
  const name = CFG.HEROES[h.kind].name;
  return h.element ? `${name} · ${h.element === 'fire' ? 'огонь' : 'вода'}` : name;
}

function deathText(e) {
  if (e.terrain === T.ACID) return 'Кислота опасна обоим — её надо перепрыгнуть!';
  if (e.element === 'water') return 'Вода не выдерживает лавы!';
  return 'Огонь гаснет в воде!';
}

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function persist() {
  if (!game.save || !game.world || game.mode === 'title' || game.mode === 'loading') return;
  const h = game.world.hero;
  if (!h.dead && Number.isFinite(h.x) && Number.isFinite(h.y)) { game.save.x = h.x; game.save.y = h.y; }
  game.save.hp = h.dead ? CFG.HERO.maxHp : h.hp;
  game.save.kills = game.world.kills;
  game.save.wood = game.world.wood;
  game.save.weaponIdx = h.weaponIdx;
  game.save.kingDead = game.world.kingDead;
  writeSave(game.save);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker не зарегистрирован:', err));
}

// Доступ для автотестов: только с ?debug в адресе.
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = { game, enterTrial, openGateModal, exitTrial, get view() { return view; } };
}
