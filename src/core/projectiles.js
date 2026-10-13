// Пул снарядов: заряды героев и споры грибов. Объекты не создаются в игровом цикле.
import { toTile } from './tilemap.js';

export function createPool(size, make) {
  return Array.from({ length: size }, make);
}

export function makeProjectile() {
  return { active: false, kind: '', owner: '', x: 0, y: 0, z: 0, px: 0, py: 0, vx: 0, vy: 0, life: 0, radius: 3, age: 0, damage: 1 };
}

export function spawnProjectile(pool, kind, owner, x, y, z, vx, vy, life, radius) {
  for (const p of pool) {
    if (p.active) continue;
    p.active = true; p.kind = kind; p.owner = owner;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy;
    p.px = x; p.py = y; p.damage = 1;
    p.life = life; p.radius = radius; p.age = 0;
    return p;
  }
  return null; // пул полон — выстрел пропускаем
}

// onWall(p) вызывается, когда снаряд врезался в препятствие.
export function updateProjectiles(pool, dt, map, onWall) {
  for (const p of pool) {
    if (!p.active) continue;
    p.px = p.x; p.py = p.y;
    p.age += dt;
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) { p.active = false; continue; }
    if (map.blockedShot(toTile(p.x), toTile(p.y))) {
      p.active = false;
      onWall?.(p);
    }
  }
}

export function makePickup() {
  return { active: false, kind: 'heart', x: 0, y: 0, px: 0, py: 0, t: 0 };
}
