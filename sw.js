// Service worker: офлайн-кэш. При каждом обновлении игры увеличивай VERSION,
// тогда старый кэш удалится и игроки получат новую версию.
const VERSION = 'vdvoem-v20';
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'lib/three.module.min.js', 'lib/three.core.min.js',
  'src/main.js', 'src/config.js', 'src/audio.js', 'src/input.js', 'src/ui.js', 'src/save.js',
  'src/core/hero.js', 'src/core/maps.js', 'src/core/mobs.js', 'src/core/overworld.js',
  'src/core/physics.js', 'src/core/projectiles.js', 'src/core/rng.js', 'src/core/tilemap.js', 'src/core/trees.js',
  'src/render/pixelart.js', 'src/render/scenes.js', 'src/render/view.js',
  'src/trials/fireWater.js',
  'assets/hero_sheet.png', 'assets/hero2_sheet.png', 'assets/hero_portraits.png', 'assets/hero2_portraits.png',
  'assets/hero_atlas.json', 'assets/hero2_atlas.json', 'assets/zombie_sheet.png', 'assets/zombie_atlas.json', 'assets/weapons.png', 'assets/weapons_atlas.json', 'assets/env.png', 'assets/env_atlas.json', 'assets/icon-192.png', 'assets/icon-512.png',
  ...['step_grass_1', 'step_grass_2', 'step_path_1', 'step_path_2', 'step_wet_1', 'step_wet_2', 'chop_1', 'chop_2', 'chop_3',
    'tree_crack', 'tree_land', 'swing', 'whoosh', 'hit', 'kill', 'hurt', 'pickup', 'heal', 'switch', 'plate', 'door',
    'water_loop'].map((n) => `assets/sfx/${n}.wav`),
  'assets/fonts/tiny5-cyrillic-400-normal.woff2', 'assets/fonts/tiny5-latin-400-normal.woff2',
  'assets/fonts/press-start-2p-cyrillic-400-normal.woff2', 'assets/fonts/press-start-2p-latin-400-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Сначала сеть (чтобы обновления доходили), при отсутствии сети — кэш.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || Response.error())),
  );
});
