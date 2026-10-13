// DOM-интерфейс: приветственный экран, HUD, модальные окна, тосты, сенсорные кнопки.
import { CFG } from './config.js';
import { heartIconURL, iconURL } from './render/pixelart.js';
import { assetURL } from './render/view.js';

const PORTRAITS = ['neutral', 'smile', 'happy', 'wink', 'hurt', 'surprised'];
const $ = (id) => document.getElementById(id);

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    i.src = assetURL(src);
  });
}

export class UI {
  constructor() {
    this.heartFull = heartIconURL(false);
    this.heartEmpty = heartIconURL(true);
    $('gem-fire-icon').src = iconURL('gemFire');
    $('gem-water-icon').src = iconURL('gemWater');
    $('logo-text').textContent = CFG.TEXT.title;
    $('subtitle').textContent = CFG.TEXT.subtitle;
    this.toastTimer = 0;
    this.portraitCtx = $('portrait').getContext('2d');
    this.portraitKey = '';
    this.heartsKey = '';
    this.titleAnim = 0;
    this.modalOpen = false;
  }

  async load() {
    const [herSheet, himSheet, herP, himP] = await Promise.all([
      loadImg(CFG.HEROES.her.sheet), loadImg(CFG.HEROES.him.sheet),
      loadImg(CFG.HEROES.her.portraits), loadImg(CFG.HEROES.him.portraits),
    ]);
    this.sheets = { her: herSheet, him: himSheet };
    this.portraits = { her: herP, him: himP };
  }

  setHeroAtlas(metas) { this.heroAtlas = metas; } // { her: atlas, him: atlas }

  hideLoading() { $('loading').classList.add('hidden'); }

  showLoadingError(text) {
    $('loading').classList.remove('hidden');
    $('loading').innerHTML = '';
    const d = document.createElement('div');
    d.className = 'loading';
    d.style.animation = 'none';
    d.style.maxWidth = '420px';
    d.style.textAlign = 'center';
    d.textContent = text;
    $('loading').appendChild(d);
  }

  setTouch(on) { document.body.classList.toggle('touch', on); }

  // ---------- приветственный экран ----------
  showTitle({ hero, hasSave, note, onPlay, onContinue, onPick }) {
    $('title').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('title-note').textContent = note || '';
    const cont = $('btn-continue'), play = $('btn-play');
    cont.classList.toggle('hidden', !hasSave);
    play.textContent = hasSave ? 'Новая игра' : 'Играть';
    play.classList.toggle('primary', !hasSave);
    this.selectHero(hero);
    const cards = document.querySelectorAll('.hero-card');
    cards.forEach((c) => { c.onclick = () => { this.selectHero(c.dataset.hero); onPick(c.dataset.hero); }; });
    cont.onclick = () => onContinue();
    play.onclick = () => onPlay();
    (hasSave ? cont : play).focus({ preventScroll: true });
  }

  selectHero(hero) {
    document.querySelectorAll('.hero-card').forEach((c) => c.classList.toggle('selected', c.dataset.hero === hero));
  }

  hideTitle() { $('title').classList.add('hidden'); }

  // Анимация героев на карточках (idle, у выбранного — cheer изредка).
  tickTitle(dt) {
    if ($('title').classList.contains('hidden') || !this.sheets) return;
    this.titleAnim += dt;
    document.querySelectorAll('.hero-card').forEach((card) => {
      const kind = card.dataset.hero;
      const ctx = card.querySelector('canvas').getContext('2d');
      const sel = card.classList.contains('selected');
      const meta = this.heroAtlas?.[kind];
      const A = meta?.views?.front;
      if (!A) return;
      // Выбранный герой иногда радуется, остальное время дышит.
      const cheer = sel && this.titleAnim % 4 > 3.1;
      const d = cheer ? A.cheer : A.idle;
      const frame = Math.floor(this.titleAnim * d.fps) % d.frames;
      // Оба героя в одном масштабе (×2), ногами на одной линии, как в игре.
      const [fw, fh] = meta.frame, [ax, ay] = meta.anchor;
      const c = ctx.canvas;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(this.sheets[kind], frame * fw, d.row * fh, fw, fh, c.width / 2 - ax * 2, c.height - 4 - ay * 2, fw * 2, fh * 2);
    });
  }

  // ---------- HUD ----------
  showHUD(mode) {
    $('hud').classList.remove('hidden');
    $('trial-hud').classList.toggle('hidden', mode !== 'trial');
    const touch = $('touch');
    touch.classList.toggle('hidden', !document.body.classList.contains('touch'));
    touch.classList.toggle('trial', mode === 'trial');
    touch.classList.toggle('world', mode !== 'trial');
  }

  hideHUD() { $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); }

  setHearts(hp, max) {
    const key = hp + '/' + max;
    if (key === this.heartsKey) return;
    const prev = this.heartsKey ? Number(this.heartsKey.split('/')[0]) : hp;
    this.heartsKey = key;
    const box = $('hearts');
    box.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = i < hp ? this.heartFull : this.heartEmpty;
      if (i < hp && i >= prev) img.classList.add('pop');
      box.appendChild(img);
    }
    box.setAttribute('aria-label', `Здоровье: ${hp} из ${max}`);
  }

  setHeartsVisible(v) { $('hearts').classList.toggle('hidden', !v); }

  setSub(text) { $('hud-sub').textContent = text; }

  setPortrait(kind, expr) {
    const key = kind + ':' + expr;
    if (key === this.portraitKey || !this.portraits) return;
    this.portraitKey = key;
    const idx = Math.max(0, PORTRAITS.indexOf(expr));
    const ctx = this.portraitCtx;
    ctx.clearRect(0, 0, 44, 44);
    ctx.drawImage(this.portraits[kind], idx * 44, 0, 44, 44, 0, 0, 44, 44);
  }

  setTrialHud({ time, fire, fireTotal, water, waterTotal }) {
    const m = Math.floor(time / 60), s = Math.floor(time % 60);
    $('trial-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('gems-fire').textContent = `${fire}/${fireTotal}`;
    $('gems-water').textContent = `${water}/${waterTotal}`;
  }

  // Оружие и дрова в HUD. icon — {canvas, rect} иконки полена из атласа.
  setWoodIcon(src, r) {
    const ctx = $('wood-icon').getContext('2d');
    ctx.clearRect(0, 0, 15, 15);
    ctx.drawImage(src, r.x, r.y, r.w, r.h, Math.floor((15 - r.w) / 2), 15 - r.h, r.w, r.h);
  }

  // Картинка оружия и прямоугольники {x, y, w, h} для окна оружия сверху.
  setWeaponArt(img, rects) { this.weaponArt = { img, rects }; this.slotsKey = ''; }

  // Окно оружия: по ячейке на каждое оружие героя, текущее подсвечено, под ним название.
  updateWeaponBar(list, weaponId) {
    const bar = $('weapon-bar');
    bar.classList.toggle('hidden', !list.length);
    const box = $('weapon-slots');
    const slotsKey = list.join(',');
    if (slotsKey !== this.slotsKey) {
      this.slotsKey = slotsKey;
      box.textContent = '';
      list.forEach((id, i) => {
        const slot = document.createElement('div');
        slot.className = 'wslot';
        slot.dataset.weapon = id;
        const r = this.weaponArt?.rects[id];
        if (r) {
          // Целый масштаб, чтобы пиксели остались квадратными; ячейка 50×28.
          const k = Math.max(1, Math.floor(Math.min(50 / r.w, 28 / r.h)));
          const c = document.createElement('canvas');
          c.width = r.w; c.height = r.h;
          c.style.width = r.w * k + 'px'; c.style.height = r.h * k + 'px';
          const ctx = c.getContext('2d');
          ctx.drawImage(this.weaponArt.img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
          slot.appendChild(c);
        }
        const key = document.createElement('span');
        key.className = 'wkey';
        key.textContent = String(i + 1);
        slot.appendChild(key);
        box.appendChild(slot);
      });
      this.barWeapon = '';
    }
    if (weaponId === this.barWeapon) return;
    const first = !this.barWeapon;
    this.barWeapon = weaponId;
    box.querySelectorAll('.wslot').forEach((s) => {
      const on = s.dataset.weapon === weaponId;
      s.classList.toggle('active', on);
      if (on && !first) { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); }
    });
    $('weapon-name').textContent = CFG.WEAPONS[weaponId]?.name || '';
  }

  setInventory(list, weaponId, wood) {
    $('hud-inv').classList.remove('hidden');
    this.updateWeaponBar(list, weaponId);
    const key = weaponId + ':' + wood;
    if (key === this.invKey) return;
    const prevWood = this.invWood ?? wood;
    this.invKey = key; this.invWood = wood;
    const wb = $('hud-wood');
    wb.classList.toggle('hidden', wood <= 0);
    $('wood-count').textContent = String(wood);
    if (wood > prevWood) { wb.classList.remove('bump'); void wb.offsetWidth; wb.classList.add('bump'); }
    document.querySelectorAll('.pad .weapon .ico-ak').forEach((e) => e.classList.toggle('hidden', weaponId !== 'ak'));
    document.querySelectorAll('.pad .weapon .ico-axe').forEach((e) => e.classList.toggle('hidden', weaponId !== 'axe'));
  }

  hideInventory() {
    $('hud-inv').classList.add('hidden');
    $('weapon-bar').classList.add('hidden');
    this.invKey = ''; this.barWeapon = '';
  }

  onPause(fn) { $('btn-pause').onclick = fn; }

  // ---------- тосты и модалки ----------
  toast(text, ms = 1800) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // buttons: [{ label, primary, onClick }]. html — доверенная разметка из кода игры.
  modal({ title, html, buttons }) {
    $('modal-title').textContent = title;
    $('modal-text').innerHTML = html || '';
    const box = $('modal-buttons');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '');
      el.textContent = b.label;
      el.onclick = () => { this.closeModal(); b.onClick?.(); };
      box.appendChild(el);
    }
    $('modal').classList.remove('hidden');
    this.modalOpen = true;
    box.querySelector('button')?.focus({ preventScroll: true });
  }

  // Плавный переход между экранами: затемнение, смена, проявление.
  transition(fn) {
    if (this.fading) return;
    const el = $('fade');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { fn(); return; }
    this.fading = true;
    el.classList.add('on');
    setTimeout(() => {
      try { fn(); } finally {
        // Кадр на перестройку сцены, потом проявляем.
        requestAnimationFrame(() => { el.classList.remove('on'); this.fading = false; });
      }
    }, 230);
  }

  closeModal() {
    $('modal').classList.add('hidden');
    this.modalOpen = false;
  }
}
