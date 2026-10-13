#!/usr/bin/env python3
"""Переупаковывает LPC-листы героев (tools/src/lpc/*_lpc.png, кадр 64×64, строки по направлениям
вверх/влево/вниз/вправо) в формат игры: одна строка на анимацию, виды front/back/side.
Влево герой смотрит отражением вида side (вправо), как и раньше.

Кроме обычных анимаций делает «вооружённые» (суффиксы _ak и _axe): оружие нарисовано прямо в кадрах,
руки его держат. Игра сама выбирает анимацию «имя_оружие», если такая есть, иначе обычную.
  * АК: поза прицеливания — кадр 5 анимации thrust (руки вытянуты вперёд); ноги для ходьбы и бега
    берутся из walk/run, верх тела — из позы прицеливания. АК (tools/src/lpc/ak_weapons.png) кладётся по кистям рук.
  * Топор: «tools/axe» из Universal LPC Spritesheet Generator (walk — топор на плече, удар — кадры 128×128).
Запуск из корня проекта: python3 tools/convert_lpc.py  (нужен Pillow)
Результат: assets/hero_sheet.png, hero2_sheet.png, hero_atlas.json, hero2_atlas.json, hero_portraits.png, hero2_portraits.png.
Переменная окружения LPC_PREVIEW=папка — сложить туда увеличенные превью для проверки глазами.
"""
import json
import os
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'src' / 'lpc'
OUT = ROOT / 'assets'
F = 64
ANCHOR = (32, 60)
GUN_HEIGHT = 15
# Первая строка анимации в LPC-листе (порядок направлений: вверх, влево, вниз, вправо).
LPC = {'spellcast': 0, 'thrust': 4, 'walk': 8, 'slash': 12, 'hurt': 20, 'idle': 22, 'jump': 26, 'run': 38}
DIR_ROW = {'back': 0, 'front': 2, 'side': 3}
VIEWS = ('front', 'back', 'side')
# Анимация игры: (анимация LPC, номера кадров, fps, зацикленность).
ANIMS = {
    'idle': ('idle', [0, 1], 2, True),
    'walk': ('walk', [1, 2, 3, 4, 5, 6, 7, 8], 11, True),
    'run': ('run', [0, 1, 2, 3, 4, 5, 6, 7], 15, True),
    'jump': ('jump', [1, 2], 10, False),
    'fall': ('jump', [3], 8, True),
    'land': ('jump', [0], 12, False),
    'dash': ('run', [1, 2, 3], 20, False),
    'hurt': ('hurt', [0, 1, 2, 3, 4, 5], 14, False),
    'cheer': ('spellcast', [4, 5], 4, True),
    'cast': ('slash', [0, 1, 2, 3, 4, 5], 17, False),
}
HEROES = {'her': ('her_lpc.png', 'hero_sheet.png', 'hero_atlas.json', 'hero_portraits.png', 'thin'),
          'him': ('him_lpc.png', 'hero2_sheet.png', 'hero2_atlas.json', 'hero2_portraits.png', 'male')}
PORTRAITS = ['neutral', 'smile', 'happy', 'wink', 'hurt', 'surprised']

# ---------- АК ----------
AIM = 5                      # кадр thrust: руки вытянуты вперёд
SPLICE_Y = 46                # ниже этой строки — ноги из walk/run, выше — верх из позы прицеливания
AK_ORIGIN_RIGHT = (26, 38)   # левый верхний угол спрайта АК (33×13) на кадре «вправо»
SKIN = [(0x99, 0x42, 0x3c), (0xcc, 0x86, 0x65), (0xe4, 0xa4, 0x7c), (0xf9, 0xd5, 0xba), (0xfa, 0xec, 0xe7)]
# АК спереди (дуло на зрителя): o — контур, g — металл, d — тёмный металл, w — дерево, b — тёмное дерево
AK_FRONT = [
    '..oooo..',
    '.ogggdo.',
    '.ogggdoo',
    '.owwwwdo',
    '.owwwwdo',
    '..owwdodo',
    '..owwdood',
    '...oddoood',
    '...oooo.od',
    '....oo...o',
]
AK_BACK = ['oooo', 'owwo', 'owwo', 'obbo', '.oo.']
AK_COL = {'o': (0, 0, 0, 255), 'g': (0x6b, 0x6b, 0x6b, 255), 'd': (0x3b, 0x3b, 0x3b, 255),
          'w': (0xa7, 0x4c, 0x00, 255), 'b': (0x49, 0x24, 0x04, 255)}
AK_FRONT_AT = (27, 40)       # где рисуется АК спереди
AK_BACK_AT = (41, 36)        # торчащий из-за плеча приклад на виде сзади
# Дуло (смещение от точки опоры героя: вправо, вверх) для вспышки выстрела.
MUZZLE = {'front': (-2, 5), 'back': (6, 26), 'side': (29, 17)}

# ---------- топор ----------
AXE_FRAME = 128
AXE_CHOP = [5, 4, 3, 1, 0, 0]  # порядок кадров удара (от замаха к опусканию), как в генераторе


def load(p):
    return Image.open(p).convert('RGBA')


def frame(img, anim, view, i):
    row = LPC[anim] + (0 if anim == 'hurt' else DIR_ROW[view])  # у «hurt» одно направление
    return img.crop((i * F, row * F, (i + 1) * F, (row + 1) * F))


def top(fr):
    bb = fr.getbbox()
    return bb[1] if bb else 0


def shifted(fr, dy):
    out = Image.new('RGBA', fr.size, (0, 0, 0, 0))
    out.alpha_composite(fr, (0, dy))
    return out


# ---------- сборка кадров с АК ----------
def ak_sprite():
    return load(SRC / 'ak_weapons.png').crop((1, 1, 34, 14))


def draw_ascii(lay, rows, at):
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in AK_COL:
                lay.putpixel((at[0] + x, at[1] + y), AK_COL[ch])


def ak_layer(view):
    """Слой с АК для вида. Возвращает (слой, поверх ли тела)."""
    lay = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    if view == 'side':
        lay.alpha_composite(ak_sprite(), AK_ORIGIN_RIGHT)
        return lay, True
    if view == 'front':
        draw_ascii(lay, AK_FRONT, AK_FRONT_AT)
        return lay, True
    draw_ascii(lay, AK_BACK, AK_BACK_AT)   # сзади ствол смотрит от нас: виден кусочек приклада
    return lay, False


def is_skin(px):
    return px[3] > 0 and any(max(abs(px[0] - s[0]), abs(px[1] - s[1]), abs(px[2] - s[2])) <= 3 for s in SKIN)


def with_ak(body, view, dy=0):
    """Тело + АК. Кисти остаются поверх оружия: оно лежит у них в руках."""
    lay, over = ak_layer(view)
    lay = shifted(lay, dy)
    out = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    if not over:
        out.alpha_composite(lay)
        out.alpha_composite(body)
        return out
    out.alpha_composite(body)
    out.alpha_composite(lay)
    bp, op, lp = body.load(), out.load(), lay.load()
    for y in range(34, 52):          # кожа поверх оружия только в области рук
        for x in range(F):
            if lp[x, y][3] > 0 and is_skin(bp[x, y]):
                op[x, y] = bp[x, y]
    return out


def aim_frame(body, view):
    return frame(body, 'thrust', view, AIM)


def drop_specks(img, min_area):
    """Стирает мелкие обособленные кусочки (остатки контуров убранных кистей), ноги и обувь остаются."""
    px = img.load()
    w, h = img.size
    seen = set()
    for sy in range(h):
        for sx in range(w):
            if px[sx, sy][3] == 0 or (sx, sy) in seen:
                continue
            comp, stack = [], [(sx, sy)]
            seen.add((sx, sy))
            while stack:
                x, y = stack.pop()
                comp.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][3] > 0:
                            seen.add((nx, ny))
                            stack.append((nx, ny))
            if len(comp) < min_area:
                for x, y in comp:
                    px[x, y] = (0, 0, 0, 0)


def spliced(body, view, src_anim, i):
    """Верх тела — из позы прицеливания, ноги — из кадра ходьбы или бега. Возвращает (кадр, сдвиг по вертикали)."""
    legs = frame(body, src_anim, view, i)
    ref = frame(body, src_anim, view, 0 if src_anim == 'run' else 1)
    dy = top(legs) - top(ref)
    up = shifted(aim_frame(body, view), dy)
    out = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    low = legs.crop((0, SPLICE_Y, F, F))
    lp = low.load()
    for y in range(low.height):          # качающиеся кисти из walk здесь лишние: руки уже заняты оружием
        for x in range(F):
            if is_skin(lp[x, y]):
                lp[x, y] = (0, 0, 0, 0)
    # На уровне бёдер из walk торчат контуры рук: оставляем только то, что в ширине самих ног (строки ниже бёдер).
    hip = 6
    xs = [x for y in range(hip, low.height) for x in range(F) if lp[x, y][3] > 0]
    if xs:
        for y in range(hip):
            for x in range(F):
                if x < min(xs) - 1 or x > max(xs) + 1:
                    lp[x, y] = (0, 0, 0, 0)
    drop_specks(low, 40)
    out.alpha_composite(low, (0, SPLICE_Y))
    out.alpha_composite(up.crop((0, 0, F, SPLICE_Y)), (0, 0))
    return out, dy


# Дыхание в покое: верх тела (и оружие) на пиксель вверх-вниз, ноги стоят.
BREATH = [0, 0, -1, -1]


def breathe(fr, dy):
    out = Image.new('RGBA', fr.size, (0, 0, 0, 0))
    out.alpha_composite(fr.crop((0, SPLICE_Y, F, F)), (0, SPLICE_Y))
    out.alpha_composite(shifted(fr, dy).crop((0, 0, F, SPLICE_Y)))
    return out


def ak_anims(body):
    """{(вид, имя): [кадры 64×64]} для АК."""
    out = {}
    for view in VIEWS:
        idle = with_ak(aim_frame(body, view), view)
        out[(view, 'idle_ak')] = [with_ak(breathe(aim_frame(body, view), dy), view, dy) for dy in BREATH]
        for name in ('jump_ak', 'fall_ak', 'land_ak'):
            out[(view, name)] = [idle]
        for name, src, idxs in (('walk_ak', 'walk', range(1, 9)), ('run_ak', 'run', range(0, 8)), ('dash_ak', 'run', (1, 2, 3))):
            fr = []
            for i in idxs:
                b, dy = spliced(body, view, src, i)
                fr.append(with_ak(b, view, dy))
            out[(view, name)] = fr
    return out


# ---------- сборка кадров с топором ----------
def axe_anims(body, variant):
    bg, fg = load(SRC / 'axe' / 'bg.png'), load(SRC / 'axe' / 'fg.png')
    walk = load(SRC / 'axe' / f'{variant}_walk.png')
    out = {}
    for view in VIEWS:
        d = DIR_ROW[view]

        def walk_frame(i):
            fr = Image.new('RGBA', (F, F), (0, 0, 0, 0))
            fr.alpha_composite(frame(body, 'walk', view, i))
            fr.alpha_composite(walk.crop((i * F, d * F, (i + 1) * F, (d + 1) * F)))
            return fr

        idle = [walk_frame(0)]
        out[(view, 'idle_axe')] = [breathe(idle[0], dy) for dy in BREATH]
        for name in ('jump_axe', 'fall_axe', 'land_axe'):
            out[(view, name)] = idle
        walk_frames = [walk_frame(i) for i in range(1, 9)]
        out[(view, 'walk_axe')] = walk_frames
        out[(view, 'run_axe')] = walk_frames
        out[(view, 'dash_axe')] = walk_frames[:3]
        swing = []
        for k in AXE_CHOP:
            box = (k * AXE_FRAME, d * AXE_FRAME, (k + 1) * AXE_FRAME, (d + 1) * AXE_FRAME)
            fr = Image.new('RGBA', (AXE_FRAME, AXE_FRAME), (0, 0, 0, 0))
            fr.alpha_composite(bg.crop(box))
            fr.alpha_composite(frame(body, 'slash', view, k), (32, 32))
            fr.alpha_composite(fg.crop(box))
            swing.append(fr)
        out[(view, 'cast_axe')] = swing
    return out


ARMED_FPS = {
    'idle_ak': (4, True), 'jump_ak': (8, False), 'fall_ak': (8, True), 'land_ak': (12, False),
    'walk_ak': (11, True), 'run_ak': (15, True), 'dash_ak': (20, False),
    'idle_axe': (4, True), 'jump_axe': (8, False), 'fall_axe': (8, True), 'land_axe': (12, False),
    'walk_axe': (11, True), 'run_axe': (15, True), 'dash_axe': (20, False), 'cast_axe': (17, False),
}


def portrait(img, anim, i):
    """Голова и плечи кадра «вид спереди», ×2 до 44×44."""
    fr = frame(img, anim, 'front', i)
    bb = fr.getbbox()
    cx = (bb[0] + bb[2]) // 2
    box = (cx - 11, bb[1], cx + 11, bb[1] + 22)
    return fr.crop(box).resize((44, 44), Image.NEAREST)


def main():
    prev = os.environ.get('LPC_PREVIEW')
    for kind, (src, sheet_name, atlas_name, portrait_name, axe_variant) in HEROES.items():
        img = load(SRC / src)
        rows = []   # (вид, имя, кадры, fps, loop)
        for view in VIEWS:
            for name, (anim, idxs, fps, loop) in ANIMS.items():
                rows.append((view, name, [frame(img, anim, view, i) for i in idxs], fps, loop))
        armed = {}
        armed.update(ak_anims(img))
        armed.update(axe_anims(img, axe_variant))
        for view in VIEWS:
            for (v, name), frames in armed.items():
                if v == view:
                    fps, loop = ARMED_FPS[name]
                    rows.append((view, name, frames, fps, loop))
        width = max(len(fr) * fr[0].width for _, _, fr, _, _ in rows)
        height = sum(fr[0].height for _, _, fr, _, _ in rows)
        sheet = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        views = {v: {} for v in VIEWS}
        y = 0
        for view, name, frames, fps, loop in rows:
            fw, fh = frames[0].size
            for k, fr in enumerate(frames):
                sheet.paste(fr, (k * fw, y))
            entry = {'row': y // F, 'y': y, 'frames': len(frames), 'fps': fps, 'loop': loop}
            if fw != F:
                entry.update({'fw': fw, 'fh': fh, 'ax': ANCHOR[0] + (fw - F) // 2, 'ay': ANCHOR[1] + (fh - F) // 2})
            views[view][name] = entry
            y += fh
        sheet.save(OUT / sheet_name)
        atlas = {
            'frame': [F, F], 'anchor': list(ANCHOR), 'gunHeight': GUN_HEIGHT,
            'layout': 'rows by animation (y in pixels); columns are frames; views: front, back, side (facing right, flip for left); '
                      'name_ak / name_axe are the same animations with the weapon in hands',
            'views': views, 'muzzle': {v: list(m) for v, m in MUZZLE.items()},
            'portrait_size': [44, 44], 'portraits': PORTRAITS,
            'license': 'Universal LPC Spritesheet (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0), см. assets/CREDITS-LPC.txt',
        }
        (OUT / atlas_name).write_text(json.dumps(atlas, indent=1) + '\n')
        src_frames = [('idle', 0), ('idle', 1), ('jump', 2), ('idle', 0), ('hurt', 1), ('jump', 0)]
        strip = Image.new('RGBA', (44 * len(PORTRAITS), 44), (0, 0, 0, 0))
        for k, (anim, i) in enumerate(src_frames):
            strip.paste(portrait(img, anim, i), (44 * k, 0))
        strip.save(OUT / portrait_name)
        print(kind, sheet.size)
        if prev:
            preview(prev, kind, armed)


def preview(folder, kind, armed):
    """Крупный лист для проверки глазами: по строке на анимацию с оружием и виду."""
    os.makedirs(folder, exist_ok=True)
    S = 3
    cols = 9
    for tag in ('ak', 'axe'):
        pick = [n for n in ARMED_FPS if n.endswith('_' + tag)]
        cw = F * S * (2 if tag == 'axe' else 1)
        im = Image.new('RGBA', (cols * cw, len(pick) * 3 * cw), (110, 150, 110, 255))
        r = 0
        for name in pick:
            for view in VIEWS:
                for k, fr in enumerate(armed[(view, name)][:cols]):
                    im.alpha_composite(fr.resize((fr.width * S, fr.height * S), Image.NEAREST), (k * cw, r * cw))
                r += 1
        im.save(os.path.join(folder, f'{kind}_{tag}.png'))


if __name__ == '__main__':
    main()
