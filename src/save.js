// Сохранение в localStorage: один ключ, версия схемы, миграция, защита от порчи.
import { CFG } from './config.js';

const DEFAULTS = () => ({
  v: CFG.SAVE_VERSION,
  hero: 'her',
  x: null, y: null, hp: CFG.HERO.maxHp,
  kills: 0,
  wood: 0, weaponIdx: 0,
  trials: { fireWater: { done: false, bestTime: null, gems: 0 } },
});

function storage() {
  try { return window.localStorage; } catch { return null; }
}

// Возвращает { data, status }: status = 'ok' | 'empty' | 'corrupted' | 'unavailable'.
export function loadSave() {
  const ls = storage();
  if (!ls) return { data: null, status: 'unavailable' };
  let raw;
  try { raw = ls.getItem(CFG.SAVE_KEY); } catch { return { data: null, status: 'unavailable' }; }
  if (raw === null) return { data: null, status: 'empty' };
  try {
    const parsed = JSON.parse(raw);
    const data = migrate(parsed);
    if (!data) throw new Error('bad schema');
    return { data, status: 'ok' };
  } catch {
    try { ls.removeItem(CFG.SAVE_KEY); } catch { /* хранилище недоступно — просто начинаем заново */ }
    return { data: null, status: 'corrupted' };
  }
}

function migrate(d) {
  if (!d || typeof d !== 'object' || !Number.isInteger(d.v)) return null;
  if (d.v > CFG.SAVE_VERSION) return null;
  // Здесь будут шаги миграции: if (d.v === 1) { ...; d.v = 2; }
  const out = DEFAULTS();
  if (d.hero === 'her' || d.hero === 'him') out.hero = d.hero;
  if (Number.isFinite(d.x) && Number.isFinite(d.y)) { out.x = d.x; out.y = d.y; }
  if (Number.isInteger(d.hp) && d.hp > 0 && d.hp <= CFG.HERO.maxHp) out.hp = d.hp;
  if (Number.isInteger(d.kills) && d.kills >= 0) out.kills = d.kills;
  // Поля, добавленные позже, — со значениями по умолчанию, если их нет.
  if (Number.isInteger(d.wood) && d.wood >= 0 && d.wood < 1e6) out.wood = d.wood;
  if (Number.isInteger(d.weaponIdx) && d.weaponIdx >= 0 && d.weaponIdx < 8) out.weaponIdx = d.weaponIdx;
  const fw = d.trials && d.trials.fireWater;
  if (fw && typeof fw === 'object') {
    out.trials.fireWater.done = fw.done === true;
    if (Number.isFinite(fw.bestTime) && fw.bestTime > 0) out.trials.fireWater.bestTime = fw.bestTime;
    if (Number.isInteger(fw.gems) && fw.gems >= 0 && fw.gems <= 99) out.trials.fireWater.gems = fw.gems;
  }
  return out;
}

export function newSave(hero) {
  const d = DEFAULTS();
  d.hero = hero === 'him' ? 'him' : 'her';
  return d;
}

export function writeSave(data) {
  const ls = storage();
  if (!ls || !data) return false;
  try {
    ls.setItem(CFG.SAVE_KEY, JSON.stringify({ ...data, v: CFG.SAVE_VERSION }));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  const ls = storage();
  try { ls?.removeItem(CFG.SAVE_KEY); } catch { /* ничего страшного */ }
}
