#!/usr/bin/env python3
"""Собирает спрайты зомби и короля зомби из Universal LPC Spritesheet Character Generator
(тело и голова зомби, одежда, золотая корона) в assets/zombie_sheet.png + assets/zombie_atlas.json.

Нужен локальный клон генератора и Pillow:
  LPC_REPO=/путь/к/Universal-LPC-Spritesheet-Character-Generator python3 tools/build_zombies.py
Переменная LPC_PREVIEW=папка — сложить туда увеличенное превью.

Лист: по строке на (вариант, вид, анимация). Виды: front, back, side (смотрит вправо, влево — отражение).
Анимации: walk (9 кадров), hurt (6 кадров). Последний вариант — король (с короной).
"""
import json
import os
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'src' / 'lpc'))
import build_lpc_heroes as L  # noqa: E402  (Lpc, layer_sheet — те же функции, что собрали героев)

F = 64
REPO = os.environ.get('LPC_REPO')
UNI_ROW = {'walk': 8, 'hurt': 20}       # где анимация лежит в универсальном листе
DIR_ROW = {'back': 0, 'front': 2, 'side': 3}
FRAMES = {'walk': 9, 'hurt': 6}
BODY = 'male'

# Одежда по вариантам: (определение, цвет). Зомби в обносках разных цветов, у некоторых волосы.
VARIANTS = [
    {'name': 'z0', 'clothes': [('legs/pants/legs_pants.json', 'brown'), ('torso/shirts/shortsleeve/torso_clothes_tshirt.json', 'red')]},
    {'name': 'z1', 'clothes': [('legs/pants/legs_pants.json', 'charcoal'), ('torso/shirts/shortsleeve/torso_clothes_tshirt.json', 'navy'),
                               ('hair/short/hair_plain.json', 'dark_gray')]},
    {'name': 'z2', 'clothes': [('legs/pants/legs_pants.json', 'slate'), ('torso/shirts/shortsleeve/torso_clothes_shortsleeve.json', 'tan')]},
    {'name': 'z3', 'clothes': [('legs/pants/legs_pants.json', 'maroon'), ('torso/shirts/shortsleeve/torso_clothes_tshirt.json', 'gray'),
                               ('hair/short/hair_mop.json', 'gray')]},
    {'name': 'king', 'crown': 'crown_gold',
     'clothes': [('legs/pants/legs_pants.json', 'maroon'), ('torso/shirts/longsleeve/torso_clothes_longsleeve2_cardigan.json', 'purple')]},
]


def universal(path_for):
    """Универсальный лист (13×54 кадров) из одиночных файлов анимаций."""
    sheet = Image.new('RGBA', (L.SHEET_W, 54 * F), (0, 0, 0, 0))
    for anim, row in UNI_ROW.items():
        p = path_for(anim)
        if os.path.exists(p):
            sheet.alpha_composite(Image.open(p).convert('RGBA'), (0, row * F))
        else:
            print('  нет файла:', os.path.relpath(p, REPO))
    return sheet


def greenish(sheet):
    """Кожа зомби в болотно-зелёный: тянем красный и синий вниз (глаза остаются тёмно-красными)."""
    px = sheet.load()
    for y in range(sheet.height):
        for x in range(sheet.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (int(r * 0.78), min(255, int(g * 1.02) + 4), int(b * 0.7), a)
    return sheet


def build_variant(lpc, spec):
    sp = os.path.join(REPO, 'spritesheets')
    layers = [
        (10, 0, greenish(universal(lambda a: os.path.join(sp, 'body/bodies/zombie', a, 'zombie.png')))),
        (100, 1, greenish(universal(lambda a: os.path.join(sp, 'head/heads/zombie/adult', a + '.png')))),
    ]
    if spec.get('crown'):
        layers.append((130, 2, universal(lambda a: os.path.join(sp, 'hat/formal/crown/adult', a, spec['crown'] + '.png'))))
    for rel, colors in spec['clothes']:
        d = lpc.definition(rel)
        for z, sheet in L.layer_sheet(lpc, d, BODY, colors):
            layers.append((z, len(layers), sheet))
    layers.sort(key=lambda t: (t[0], t[1]))
    final = Image.new('RGBA', (L.SHEET_W, 54 * F), (0, 0, 0, 0))
    for _, _, sheet in layers:
        final.alpha_composite(sheet)
    return final


def frame(img, anim, view, i):
    row = UNI_ROW[anim] + (0 if anim == 'hurt' else DIR_ROW[view])   # у «hurt» одно направление
    return img.crop((i * F, row * F, (i + 1) * F, (row + 1) * F))


def main():
    if not REPO:
        sys.exit('Укажи LPC_REPO — путь к клону Universal-LPC-Spritesheet-Character-Generator')
    lpc = L.Lpc(REPO)
    rows = []   # (имя варианта, вид, анимация, кадры)
    for spec in VARIANTS:
        img = build_variant(lpc, spec)
        for view in ('front', 'back', 'side'):
            rows.append((spec['name'], view, 'walk', [frame(img, 'walk', view, i) for i in range(FRAMES['walk'])]))
        rows.append((spec['name'], 'all', 'hurt', [frame(img, 'hurt', 'front', i) for i in range(FRAMES['hurt'])]))
    sheet = Image.new('RGBA', (FRAMES['walk'] * F, len(rows) * F), (0, 0, 0, 0))
    atlas_rows = {}
    for r, (name, view, anim, frames) in enumerate(rows):
        for k, fr in enumerate(frames):
            sheet.paste(fr, (k * F, r * F))
        atlas_rows.setdefault(name, {})[f'{anim}_{view}' if anim == 'walk' else anim] = {'row': r, 'frames': len(frames)}
    out = ROOT / 'assets'
    sheet.save(out / 'zombie_sheet.png')
    atlas = {
        'frame': [F, F], 'anchor': [32, 60], 'king': VARIANTS[-1]['name'],
        'variants': [v['name'] for v in VARIANTS], 'rows': atlas_rows,
        'fps': {'walk': 8, 'hurt': 12},
        'license': 'Universal LPC Spritesheet (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0), см. assets/CREDITS-LPC.txt',
    }
    (out / 'zombie_atlas.json').write_text(json.dumps(atlas, indent=1) + '\n')
    print('zombie_sheet', sheet.size, len(VARIANTS), 'вариантов')
    prev = os.environ.get('LPC_PREVIEW')
    if prev:
        os.makedirs(prev, exist_ok=True)
        S = 3
        im = Image.new('RGBA', (FRAMES['walk'] * F * S, len(rows) * F * S), (110, 150, 110, 255))
        im.alpha_composite(sheet.resize((sheet.width * S, sheet.height * S), Image.NEAREST))
        im.save(os.path.join(prev, 'zombies.png'))


if __name__ == '__main__':
    main()
