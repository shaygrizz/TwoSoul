// Офлайн-сборка: один HTML-файл, который открывается двойным щелчком (file://),
// без сервера. Скрипты собираются в один, картинки, JSON и шрифты встраиваются внутрь.
// Запуск из корня проекта: npm run build:offline  →  dist/vdvoem.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p));
const MIME = { '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const dataURL = (p) => `data:${MIME[extname(p)]};base64,${read(p).toString('base64')}`;

// 1) Скрипты: модули → один IIFE.
const js = await build({
  entryPoints: [join(ROOT, 'src/main.js')], bundle: true, format: 'iife', minify: true,
  write: false, target: ['es2020'], legalComments: 'none',
});
const bundle = js.outputFiles[0].text;

// 2) Картинки и JSON из assets/.
const embed = { files: {}, json: {}, audio: {} };
for (const f of readdirSync(join(ROOT, 'assets'))) {
  const p = 'assets/' + f;
  if (f.endsWith('.png')) embed.files[p] = dataURL(p);
  else if (f.endsWith('.json')) embed.json[p] = JSON.parse(read(p).toString('utf8'));
}

// Звуки: wav в base64 (декодирует сам браузер).
for (const f of readdirSync(join(ROOT, 'assets/sfx'))) {
  if (f.endsWith('.wav')) embed.audio['assets/sfx/' + f] = read('assets/sfx/' + f).toString('base64');
}

// 3) Стили со шрифтами внутри.
let css = read('css/style.css').toString('utf8')
  .replace(/url\('\.\.\/(assets\/fonts\/[^']+)'\)/g, (_, p) => `url('${dataURL(p)}')`);

// 4) Страница.
let html = read('index.html').toString('utf8');
html = html
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="(apple-touch-icon|icon)" href="([^"]+)">/g, (_, rel, href) => `<link rel="${rel}" href="${dataURL(href)}">`)
  .replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="src\/main.js"><\/script>/, () =>
    `<script>window.__EMBED=${JSON.stringify(embed)};</script>\n<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`);

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/vdvoem.html'), html);
console.log('dist/vdvoem.html', (html.length / 1024).toFixed(0) + ' КБ');
