#!/usr/bin/env python3
"""Вырезает нужные спрайты из CC0-тайлсета Ninja Adventure в assets/env.png + assets/env_atlas.json.

Спрайты хранятся в исходном размере, увеличение (scale) делается при отрисовке.
Точка привязки — низ по центру (там, где объект стоит на земле).
Запуск из корня проекта: python3 tools/import_cc0_assets.py
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'src' / 'cc0' / 'ninja_adventure_tileset.png'
# Деревья и дома увеличиваем вдвое: наши герои 32×42, а тайлсет рассчитан на персонажей 16×16.
# Пень и дрова оставляем в исходном размере, иначе они больше героя.
# имя: ((x0, y0, x1, y1) в исходном тайлсете, увеличение)
PICKS = {
    'naTree': ((0, 160, 32, 192), 2),
    'naPine': ((96, 160, 128, 192), 2),
    'naPinkTree': ((64, 256, 96, 288), 2),
    'naBigTree': ((176, 128, 208, 160), 2),
    'naHouse1': ((0, 0, 64, 48), 2),
    'naHouse2': ((64, 0, 128, 48), 2),
    'naHouse3': ((192, 0, 256, 48), 2),
    'naStump': ((96, 289, 128, 318), 1),
    'naLogs': ((144, 288, 160, 304), 1),
}


def main():
    src = Image.open(SRC).convert('RGBA')
    crops = {}
    for name, (box, _) in PICKS.items():
        c = src.crop(box)
        bb = c.getbbox()
        crops[name] = c.crop(bb)
    pad, W = 2, 256
    x = y = pad
    row_h = 0
    rects = {}
    for name, c in crops.items():
        if x + c.width + pad > W:
            x, y = pad, y + row_h + pad
            row_h = 0
        rects[name] = {'x': x, 'y': y, 'w': c.width, 'h': c.height, 'ax': c.width // 2, 'ay': c.height - 1,
                       'scale': PICKS[name][1]}
        x += c.width + pad
        row_h = max(row_h, c.height)
    H = y + row_h + pad
    sheet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for name, c in crops.items():
        r = rects[name]
        sheet.paste(c, (r['x'], r['y']))
    sheet.save(ROOT / 'assets' / 'env.png')
    meta = {'image': 'assets/env.png', 'license': 'CC0 (Ninja Adventure by Pixel-boy)', 'sprites': rects}
    (ROOT / 'assets' / 'env_atlas.json').write_text(json.dumps(meta, indent=1) + '\n')
    print('ok', sheet.size, len(rects))


if __name__ == '__main__':
    main()
