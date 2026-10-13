// Все игровые константы в одном месте. Единицы: пиксели мира и секунды.
export const CFG = {
  TILE: 16,
  STEP: 1 / 60,          // фиксированный шаг логики
  MAX_STEPS: 5,          // защита от «спирали смерти» после долгой паузы

  HERO: {
    speed: 72,
    sprintMul: 1.6,      // бег при зажатом Shift: во сколько раз быстрее ходьбы
    accel: 18,           // насколько быстро скорость догоняет ввод (1/с)
    halfW: 5, halfH: 3,  // «пятно» на земле для коллизий
    jumpV: 170,
    gravity: 600,
    dashSpeed: 210, dashTime: 0.16, dashCooldown: 0.9,
    castTime: 0.18,
    landTime: 0.09,      // короткий кадр приземления
    maxHp: 5, iframes: 1.0, hurtTime: 0.35,
    respawnDelay: 1.2,
    jumpSafeZ: 9,        // выше этой высоты мобы и споры под ногами не задевают
  },

  // Оружие. Огнестрел: cooldown — секунды между выстрелами, spread — разброс в радианах.
  // Ближний бой: swingTime — длительность замаха, impactAt — момент удара, reach — насколько далеко бьёт.
  WEAPONS: {
    ak: { type: 'gun', name: 'АК-47', cooldown: 0.16, speed: 340, life: 0.55, spread: 0.06, damage: 1, radius: 3, bullet: 'bulletAk' },
    axe: { type: 'melee', name: 'Топор', cooldown: 0.42, swingTime: 0.34, impactAt: 0.13, reach: 13, radius: 12, damage: 2 },
  },
  // Деревья можно рубить топором: hp ударов, потом падение, пень и дрова.
  TREE: { hp: 4, fallTime: 0.75, logsMin: 2, logsMax: 3, regrow: 90, reach: 15 },
  AUDIO: { master: 0.8, water: 0.7 }, // общая громкость и максимальная громкость воды у берега
  GUN_HEIGHT: 15,        // высота ствола над землёй (атлас героя может задать свою: gunHeight)
  GUN_SCALE: 0.75,       // спрайт оружия чуть меньше, чтобы не спорил с героем
  SPORE: { speed: 62, life: 2.4, height: 4, radius: 3 },

  MOBS: {
    slime:    { hp: 4, radius: 6, speed: 34, aggro: 90, height: 12, knock: 90, respawn: 25 },
    bat:      { hp: 3, radius: 6, speed: 46, aggro: 100, height: 18, knock: 70, respawn: 25, leash: 70 },
    mushroom: { hp: 6, radius: 7, aggro: 115, height: 18, knock: 0, respawn: 30, fireEvery: 2.2 },
  },
  HEART_DROP_CHANCE: 0.3,

  VIEW: {
    targetWorldPx: 220,  // сколько пикселей мира минимум видно по короткой стороне
    maxDpr: 2,
  },

  // Ощущение плавности: всё, что сглаживает картинку, но не влияет на правила.
  FEEL: {
    camFollow: 7,        // скорость догоняния камеры (1/с)
    camLead: 0.22,       // упреждение по скорости героя (с)
    camAimLead: 0.22,    // смещение к прицелу (доля расстояния)
    camAimMax: 40,       // максимум смещения к прицелу (px)
    squashBack: 14,      // скорость возврата формы после сжатия (1/с)
    gunTurn: 28,         // скорость поворота оружия (1/с)
    hitStop: 0.045,      // заморозка логики при убийстве (с)
    shake: { shoot: 0.6, hurt: 3.5, kill: 1.6 },
  },

  ASSET_VERSION: 18,     // меняй при замене картинок и атласов: добавляется к адресу и обходит кэш браузера

  SAVE_KEY: 'vdvoem.save',
  SAVE_VERSION: 1,

  // Кто есть кто. Спрайт hero_sheet — она, hero2_sheet — он.
  HEROES: {
    // sheetArmed — те же кадры без рук на теле: с огнестрелом руки рисует игра, чтобы они держали оружие.
    // arm — цвета руки: рукав на sleeveFrac длины от плеча, дальше кожа; обводка.
    her: { name: 'Она', sheet: 'assets/hero_sheet.png', atlas: 'assets/hero_atlas.json', portraits: 'assets/hero_portraits.png', weapons: ['ak', 'axe'], element: 'water',
           arm: { sleeve: '#f6e9d2', skin: '#eab99d', outline: '#150d22', sleeveFrac: 0.3 } },
    him: { name: 'Он',  sheet: 'assets/hero2_sheet.png', atlas: 'assets/hero2_atlas.json', portraits: 'assets/hero2_portraits.png', weapons: ['ak', 'axe'], element: 'fire',
           arm: { sleeve: '#2a2833', skin: '#e9bf9f', outline: '#0d0a14', sleeveFrac: 0.8 } },
  },

  TEXT: {
    title: 'Вдвоём',
    subtitle: 'маленькое приключение на двоих',
  },
};
