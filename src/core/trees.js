// Деревья, которые можно рубить: удары, падение, пень, дрова, отрастание. Только логика.
import { CFG } from '../config.js';

const TILE = CFG.TILE;

// Рубятся только отдельные деревья внутри карты; лесная граница — нет.
export function createTrees(map) {
  return map.objects
    .filter((o) => (o.type === 'tree' || o.type === 'pine') && !o.border)
    .map((o) => ({
      obj: o, tx: o.tx, ty: o.ty,
      x: (o.tx + 0.5) * TILE, y: (o.ty + 1) * TILE - 2,
      hp: CFG.TREE.hp, state: 'up', fallT: 0, fallDir: 1, regrowT: 0, shakeT: 0, hits: 0,
    }));
}

// Удар топором в точку (x, y). Возвращает дерево, по которому попали, или null.
export function chopAt(w, x, y, dirX) {
  const R = CFG.TREE.reach;
  let best = null, bestD = R * R;
  for (const t of w.trees) {
    if (t.state !== 'up') continue;
    const dx = t.x - x, dy = (t.y - 4) - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { best = t; bestD = d; }
  }
  if (!best) return null;
  best.hp -= 1;
  best.hits += 1;
  best.shakeT = 0.25;
  w.events.push({ type: 'chop', x: best.x, y: best.y, z: 14, dx: dirX, idx: w.trees.indexOf(best) });
  if (best.hp <= 0) {
    best.state = 'falling';
    best.fallT = 0;
    best.fallDir = dirX >= 0 ? 1 : -1;
    // Падающее дерево больше не держит пули.
    w.map.shotBlock[best.ty * w.map.w + best.tx] = 0;
    w.events.push({ type: 'treeFall', x: best.x, y: best.y, z: 0, dir: best.fallDir, idx: w.trees.indexOf(best) });
  }
  return best;
}

// spawnLog(x, y) — бросить полено на землю.
export function updateTrees(w, dt, hero, spawnLog) {
  const T = CFG.TREE;
  for (const t of w.trees) {
    t.shakeT = Math.max(0, t.shakeT - dt);
    if (t.state === 'falling') {
      t.fallT += dt;
      if (t.fallT >= T.fallTime) {
        t.state = 'stump';
        t.regrowT = T.regrow;
        const n = T.logsMin + Math.floor(w.rnd() * (T.logsMax - T.logsMin + 1));
        for (let i = 0; i < n; i++) {
          // Поленья ложатся вдоль упавшего ствола.
          spawnLog(t.x + t.fallDir * (10 + i * 9) + (w.rnd() - 0.5) * 6, t.y + (w.rnd() - 0.5) * 8);
        }
        w.events.push({ type: 'treeLand', x: t.x + t.fallDir * 24, y: t.y, z: 0, idx: w.trees.indexOf(t) });
      }
    } else if (t.state === 'stump') {
      t.regrowT -= dt;
      const far = (hero.x - t.x) ** 2 + (hero.y - t.y) ** 2 > 120 * 120;
      if (t.regrowT <= 0 && far) {
        t.state = 'up';
        t.hp = T.hp;
        w.map.shotBlock[t.ty * w.map.w + t.tx] = 1;
        w.events.push({ type: 'treeGrow', x: t.x, y: t.y, z: 0, idx: w.trees.indexOf(t) });
      }
    }
  }
}

// Ближайшее целое дерево перед героем (для автоприцела топора).
export function nearestTree(w, h, maxDist) {
  let best = null, bestD = maxDist * maxDist;
  for (const t of w.trees) {
    if (t.state !== 'up') continue;
    const dx = t.x - h.x, dy = (t.y - 4) - h.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { best = { x: t.x, y: t.y - 4 }; bestD = d; }
  }
  return best;
}
