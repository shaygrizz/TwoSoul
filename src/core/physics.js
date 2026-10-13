// Движение прямоугольного «пятна» на земле сквозь тайловую сетку, по осям раздельно.
import { CFG } from '../config.js';

const EPS = 0.001;

// blocked(tx, ty) -> true, если клетка непроходима.
export function moveBox(a, dx, dy, hw, hh, blocked) {
  if (dx !== 0) {
    a.x += dx;
    forEachOverlap(a, hw, hh, blocked, (tx) => {
      const left = tx * CFG.TILE, right = left + CFG.TILE;
      if (dx > 0) a.x = Math.min(a.x, left - hw - EPS);
      else a.x = Math.max(a.x, right + hw + EPS);
    });
  }
  if (dy !== 0) {
    a.y += dy;
    forEachOverlap(a, hw, hh, blocked, (_tx, ty) => {
      const top = ty * CFG.TILE, bottom = top + CFG.TILE;
      if (dy > 0) a.y = Math.min(a.y, top - hh - EPS);
      else a.y = Math.max(a.y, bottom + hh + EPS);
    });
  }
}

function forEachOverlap(a, hw, hh, blocked, fn) {
  const T = CFG.TILE;
  const x0 = Math.floor((a.x - hw) / T), x1 = Math.floor((a.x + hw) / T);
  const y0 = Math.floor((a.y - hh) / T), y1 = Math.floor((a.y + hh) / T);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (blocked(tx, ty)) fn(tx, ty);
    }
  }
}

export function boxBlocked(x, y, hw, hh, blocked) {
  const T = CFG.TILE;
  const x0 = Math.floor((x - hw) / T), x1 = Math.floor((x + hw) / T);
  const y0 = Math.floor((y - hh) / T), y1 = Math.floor((y + hh) / T);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (blocked(tx, ty)) return true;
  }
  return false;
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
