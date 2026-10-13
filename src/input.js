// Ввод: клавиатура, мышь, сенсорный джойстик и кнопки. На выходе один снимок за шаг логики.
const KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], shoot: ['KeyJ', 'KeyZ'], dash: ['KeyK', 'KeyX'], sprint: ['ShiftLeft', 'ShiftRight'],
  swap: ['KeyQ', 'Tab'], pause: ['Escape', 'KeyP'],
  super: ['KeyF', 'KeyR'], switch: ['KeyE'], slot1: ['Digit1', 'Numpad1'], slot2: ['Digit2', 'Numpad2'],
};
const CODE_TO_ACTION = {};
for (const [a, codes] of Object.entries(KEYS)) for (const c of codes) CODE_TO_ACTION[c] = a;

export class Input {
  constructor({ canvas, touchRoot, screenToWorld }) {
    this.held = new Set();
    this.pressed = new Set();   // нажатия с прошлого шага (для прыжка, рывка, смены)
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.touchHeld = new Set();
    this.mouseDown = false;
    this.mousePos = null;
    this.mouseActive = false;   // мышь двигали — значит прицел по курсору
    // Кнопка стрельбы на телефоне — она же прицел: зажал и ведёшь пальцем.
    this.stick = { id: null, ox: 0, oy: 0, dir: null };
    this.screenToWorld = screenToWorld;
    this.touchUsed = false;
    this.listeners = [];

    this.on(window, 'keydown', (e) => {
      const a = CODE_TO_ACTION[e.code];
      if (!a) return;
      // На кнопках интерфейса пробел, Enter и Tab работают как обычно.
      if (e.target instanceof HTMLElement && e.target.closest('button') && (e.code === 'Space' || e.code === 'Tab')) return;
      e.preventDefault();
      if (!e.repeat) this.pressed.add(a);
      this.held.add(a);
    });
    this.on(window, 'keyup', (e) => { const a = CODE_TO_ACTION[e.code]; if (a) this.held.delete(a); });
    this.on(window, 'blur', () => this.reset());

    // Только настоящая мышь: касания экрана сюда не попадают.
    this.on(canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      this.mouseDown = true;
      this.mouseActive = true;
      this.mousePos = { x: e.clientX, y: e.clientY };
    });
    this.on(window, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseActive = true;
      this.mousePos = { x: e.clientX, y: e.clientY };
    });
    this.on(window, 'pointerup', (e) => { if (e.pointerType === 'mouse') this.mouseDown = false; });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    // Колёсико мыши листает оружие.
    this.on(canvas, 'wheel', (e) => {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      this.pressed.add('switch');
    }, { passive: false });

    this.bindTouch(touchRoot);
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  bindTouch(root) {
    const zone = root.querySelector('[data-joy-zone]');
    const base = root.querySelector('[data-joy-base]');
    const knob = root.querySelector('[data-joy-knob]');
    const R = 44; // радиус джойстика в CSS-пикселях

    this.on(zone, 'pointerdown', (e) => {
      if (this.joy.id !== null) return;
      e.preventDefault();
      this.touchUsed = true;
      this.mouseActive = false;
      zone.setPointerCapture?.(e.pointerId);
      this.joy.id = e.pointerId;
      this.joy.ox = e.clientX; this.joy.oy = e.clientY;
      this.joy.x = 0; this.joy.y = 0;
      base.style.transform = `translate(${e.clientX - 50}px, ${e.clientY - 50}px)`;
      knob.style.transform = 'translate(0px, 0px)';
      base.classList.add('on');
    });
    const move = (e) => {
      if (e.pointerId !== this.joy.id) return;
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // dx, dy уже ограничены радиусом, поэтому вектор не длиннее 1.
      const dead = Math.min(1, l / R) < 0.18;
      this.joy.x = dead ? 0 : dx / R;
      this.joy.y = dead ? 0 : dy / R;
    };
    const end = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = null; this.joy.x = 0; this.joy.y = 0;
      base.classList.remove('on');
    };
    this.on(zone, 'pointermove', move);
    this.on(zone, 'pointerup', end);
    this.on(zone, 'pointercancel', end);

    for (const btn of root.querySelectorAll('[data-action]')) {
      const a = btn.dataset.action;
      const aimKnob = btn.querySelector('[data-aim-knob]');
      this.on(btn, 'pointerdown', (e) => {
        e.preventDefault();
        this.touchUsed = true;
        this.mouseActive = false;
        btn.setPointerCapture?.(e.pointerId);
        this.pressed.add(a);
        this.touchHeld.add(a);
        btn.classList.add('down');
        if (aimKnob) { this.stick.id = e.pointerId; this.stick.ox = e.clientX; this.stick.oy = e.clientY; this.stick.dir = null; }
      });
      if (aimKnob) {
        const AR = 30;    // насколько далеко ходит ручка прицела
        const DEAD = 10;  // меньше — просто стрельба с автоприцелом
        this.on(btn, 'pointermove', (e) => {
          if (e.pointerId !== this.stick.id) return;
          let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
          const l = Math.hypot(dx, dy);
          this.stick.dir = l > DEAD ? { x: dx / l, y: dy / l } : null;
          btn.classList.toggle('aiming', Boolean(this.stick.dir));
          if (l > AR) { dx = (dx / l) * AR; dy = (dy / l) * AR; }
          aimKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        });
      }
      const up = () => {
        this.touchHeld.delete(a); btn.classList.remove('down');
        if (aimKnob) { this.stick.id = null; this.stick.dir = null; aimKnob.style.transform = ''; btn.classList.remove('aiming'); }
      };
      this.on(btn, 'pointerup', up);
      this.on(btn, 'pointercancel', up);
      this.on(btn, 'lostpointercapture', up);
    }
  }

  // Точка прицела в мире или null (нет мыши — работает автоприцел).
  aimWorld() {
    if (!this.mouseActive || !this.mousePos) return null;
    return this.screenToWorld(this.mousePos.x, this.mousePos.y);
  }

  // Направление прицела с сенсорной кнопки или null (тогда автоприцел).
  aimDir() { return this.stick.id !== null ? this.stick.dir : null; }

  isHeld(a) { return this.held.has(a) || this.touchHeld.has(a); }

  // Снимок ввода для одного шага логики. Нажатия «съедаются».
  sample() {
    let mx = 0, my = 0;
    if (this.isHeld('left')) mx -= 1;
    if (this.isHeld('right')) mx += 1;
    if (this.isHeld('up')) my -= 1;
    if (this.isHeld('down')) my += 1;
    if (this.joy.id !== null) { mx += this.joy.x; my += this.joy.y; }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }

    const aim = this.aimWorld();

    const snap = {
      mx, my, aim, aimDir: this.aimDir(),
      jump: this.pressed.has('jump'),
      dash: this.pressed.has('dash'),
      sprint: this.isHeld('sprint'),
      shoot: this.isHeld('shoot') || this.pressed.has('shoot') || this.mouseDown,
      swap: this.pressed.has('swap'),
      switchWeapon: this.pressed.has('switch'),
      slot: this.pressed.has('slot1') ? 0 : this.pressed.has('slot2') ? 1 : -1,
      pause: this.pressed.has('pause'),
      super: this.pressed.has('super'),
    };
    this.pressed.clear();
    return snap;
  }

  reset() {
    this.held.clear(); this.pressed.clear(); this.touchHeld.clear();
    this.mouseDown = false;
    this.joy.id = null; this.joy.x = 0; this.joy.y = 0;
    this.stick.id = null; this.stick.dir = null;
    document.querySelectorAll('[data-aim-knob]').forEach((k) => { k.style.transform = ''; });
    document.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
  }

  dispose() { for (const off of this.listeners) off(); this.listeners = []; }
}
