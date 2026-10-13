#!/usr/bin/env python3
"""Собирает спрайт-листы героев из слоёв Universal LPC Spritesheet Character Generator.

Повторяет логику генератора (sources/canvas/renderer.ts, sources/state/path.ts):
  * путь к слою: spritesheets/<layer[bodyType]><анимация>.png;
  * перекраска по палитрам palette_definitions (исходный вариант — base материала, допуск ±1);
  * слои рисуются по возрастанию zPos;
  * анимации кладутся в универсальную раскладку LPC (кадр 64×64, строки: вверх, влево, вниз, вправо).

Запуск:
  python3 tools/lpc/build_lpc_heroes.py /путь/к/Universal-LPC-Spritesheet-Character-Generator
Результат — assets/lpc/: her_lpc.png, him_lpc.png, lpc_atlas.json, CREDITS-LPC.txt, превью.
"""
import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'lpc')
F = 64
SHEET_W = 13 * F

# Анимации: папка, строка в универсальном листе, число строк (направлений), кадров, fps, зацикленность.
ANIMS = [
    ('spellcast', 0, 4, 7, 10, False),
    ('thrust', 4, 4, 8, 12, False),
    ('walk', 8, 4, 9, 10, True),
    ('slash', 12, 4, 6, 14, False),
    ('shoot', 16, 4, 13, 16, False),
    ('hurt', 20, 1, 6, 10, False),
    ('climb', 21, 1, 6, 8, True),
    ('idle', 22, 4, 2, 2, True),
    ('jump', 26, 4, 5, 10, False),
    ('sit', 30, 4, 3, 4, False),
    ('emote', 34, 4, 3, 4, False),
    ('run', 38, 4, 8, 14, True),
    ('combat_idle', 42, 4, 2, 3, True),
    ('backslash', 46, 4, 13, 16, False),
    ('halfslash', 50, 4, 6, 14, False),
]
# Имя анимации в sheet_definitions для проверки поддержки (как в renderer.ts).
ANIM_META = {'combat_idle': 'combat', 'backslash': '1h_backslash', 'halfslash': '1h_halfslash'}
DIRS = ['up', 'left', 'down', 'right']

# Свои палитры (по 6 цветов, как у материала cloth: от контура к блику).
CREAM = ['#3a2a28', '#6f5f56', '#a8977f', '#d9c9ad', '#efe4cc', '#fffaf0']
SNOW = ['#3a3040', '#8c8796', '#c4c1cc', '#e2e0e8', '#f4f3f7', '#ffffff']
DENIM = ['#0e0a18', '#1b1f36', '#283256', '#344574', '#475d92', '#6680b2']

# Её и его образ. def — файл в sheet_definitions, colors — цель перекраски
# (имя варианта из палитры материала или список hex); для слоёв с двумя цветами — по ключам.
HEROES = {
    'her': {
        'body': 'female',
        'layers': [
            {'def': 'body/body.json', 'colors': 'light'},
            {'def': 'head/heads/human/heads_human_female.json', 'colors': {'color_1': 'light', 'color_2': 'brown'}, 'lips': True},
            {'def': 'head/nose/head_nose_button.json', 'colors': 'light'},
            {'def': 'head/eyebrows/eyebrows_thin.json', 'colors': 'black'},
            {'def': 'feet/shoes/feet_shoes_basic.json', 'colors': SNOW},
            {'def': 'legs/pants/legs_pants.json', 'colors': SNOW, 'print': 'pants'},
            {'def': 'torso/shirts/shortsleeve/torso_clothes_tshirt.json', 'colors': CREAM, 'print': 'shirt'},
            # Длинные прямые волосы, чёлка чуть больше половины лба, пряди спереди
            # и длинная прядь на её правой стороне (слева на виде спереди), как на её рисунке.
            {'def': 'hair/long/hair_long_straight.json', 'colors': 'black'},
            {'def': 'hair/short/hair_parted_side_bangs.json', 'colors': 'black'},
            {'def': 'hair/extensions/bangs/hairext_long_straightl.json', 'colors': 'black'},
            {'def': 'hair/extensions/bangs/hairext_long_straightr.json', 'colors': 'black'},
        ],
        # Пряди спереди по плечам до пояса (на виде спереди) — дорисовываем сами, в генераторе таких нет.
        'strands': {'len': 14, 'colors': 'black'},
        # Чёлка на виде спереди: закрывает лоб чуть больше половины, на её правой стороне
        # (слева на экране) короткая прядь опускается до глаза и почти закрывает его.
        'fringe': {'colors': 'black', 'side': 'left'},
    },
    'him': {
        'body': 'male',
        'layers': [
            {'def': 'body/body.json', 'colors': 'light'},
            {'def': 'head/heads/human/heads_human_male.json', 'colors': {'color_1': 'light', 'color_2': 'brown'}, 'lips': True},
            {'def': 'head/nose/head_nose_button.json', 'colors': 'light'},
            {'def': 'head/eyebrows/eyebrows_thick.json', 'colors': 'black'},
            {'def': 'feet/shoes/feet_shoes_basic.json', 'colors': 'black'},
            {'def': 'legs/pants/legs_pants.json', 'colors': DENIM},
            {'def': 'torso/shirts/shortsleeve/torso_clothes_tshirt.json', 'colors': SNOW},
            {'def': 'torso/shirts/longsleeve/torso_clothes_longsleeve2_cardigan.json', 'colors': 'charcoal'},
            {'def': 'hair/short/hair_plain.json', 'colors': 'black'},  # снизу: волосы по бокам, у висков
            {'def': 'hair/short/hair_mop.json', 'colors': 'black'},  # сверху: объёмная шапка с чёлкой,
        ],
    },
}

# Принт сердечками: 3×3, розовый с тенью; min_dist — расстояние между сердечками.
HEART_C = (226, 88, 128, 255)
HEART_SH = (176, 58, 96, 255)
PRINTS = {
    # На футболке — крупные сердечки (как на её рисунке), на штанах — мелкие.
    'shirt': {'dirs': ('down', 'left', 'right'), 'min_dist': 8, 'shape': ['xx.xx', 'xxxxx', '.xxx.', '..x..']},
    'pants': {'dirs': ('down', 'left', 'right', 'up'), 'min_dist': 7, 'shape': ['x.x', 'xxx', '.x.']},
}


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Lpc:
    def __init__(self, repo):
        self.repo = repo
        self.pal = {}

    def palette(self, material):
        if material not in self.pal:
            d = os.path.join(self.repo, 'palette_definitions', material)
            meta = json.load(open(os.path.join(d, f'meta_{material}.json')))
            colors = json.load(open(os.path.join(d, f'{material}_ulpc.json')))
            self.pal[material] = (meta['base'], colors)
        return self.pal[material]

    def definition(self, rel):
        return json.load(open(os.path.normpath(os.path.join(self.repo, 'sheet_definitions', rel))))

    def mappings(self, d, colors):
        """Пары (исходные цвета, целевые цвета) для перекраски слоя."""
        rec = d.get('recolors')
        if not rec:
            return []
        out = []
        groups = {'color_1': rec} if 'material' in rec else rec
        targets = colors if isinstance(colors, dict) else {'color_1': colors}
        for key, g in groups.items():
            target = targets.get(key)
            if target is None:
                continue
            base, pal = self.palette(g['material'])
            src = pal[g.get('base', base)]
            dst = target if isinstance(target, list) else pal[target]
            assert len(src) == len(dst), (d['name'], key)
            out.append(([hexrgb(c) for c in src], [hexrgb(c) for c in dst]))
        return out


def recolor(img, maps):
    if not maps:
        return img
    px = img.load()
    w, h = img.size
    pairs = [(s, t) for src, dst in maps for s, t in zip(src, dst)]
    cache = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            key = (r, g, b)
            if key not in cache:
                cache[key] = next((t for s, t in pairs
                                   if abs(r - s[0]) <= 1 and abs(g - s[1]) <= 1 and abs(b - s[2]) <= 1), None)
            t = cache[key]
            if t:
                px[x, y] = t + (a,)
    return img


def layer_sheet(lpc, d, body, colors, head_kind=None):
    """Слой предмета в универсальной раскладке (по всем поддержанным анимациям)."""
    sheets = []
    for num in range(1, 10):
        L = d.get(f'layer_{num}')
        if not L:
            break
        base = L.get(body)
        if base and '${head}' in base:          # выражения лица: папка по типу головы
            base = base.replace('${head}', head_kind or body)
        if not base or L.get('custom_animation'):
            continue
        sheet = Image.new('RGBA', (SHEET_W, 54 * F), (0, 0, 0, 0))
        anims = set(d.get('animations') or [])
        for folder, row, _, _, _, _ in ANIMS:
            if ANIM_META.get(folder, folder) not in anims and folder not in anims:
                continue
            path = os.path.join(lpc.repo, 'spritesheets', base + folder + '.png')
            if not os.path.exists(path):
                print('  нет файла:', os.path.relpath(path, lpc.repo))
                continue
            img = recolor(Image.open(path).convert('RGBA'), lpc.mappings(d, colors))
            sheet.alpha_composite(img, (0, row * F))
        sheets.append((L['zPos'], sheet))
    return sheets


def heart_print(final, layer, kind):
    """Розовые сердечки по ткани слоя, только там, где ткань видна в готовом кадре."""
    P = PRINTS[kind]
    fp, lp = final.load(), layer.load()
    for folder, row, nrows, nfr, _, _ in ANIMS:
        for r in range(nrows):
            direction = DIRS[r] if nrows == 4 else 'down'
            if direction not in P['dirs']:
                continue
            for c in range(nfr):
                ox, oy = c * F, (row + r) * F
                pts = [(x, y) for y in range(F) for x in range(F) if lp[ox + x, oy + y][3] > 0]
                if not pts:
                    continue
                # Жадно: сверху вниз ставим сердечко везде, где оно целиком на светлой видимой ткани
                # и не ближе min_dist к уже поставленным.
                placed = []
                for gy, gx in sorted((y, x) for x, y in pts):
                    if any(abs(gx - px_) + abs(gy - py_) < P['min_dist'] for px_, py_ in placed):
                        continue
                    cells = [(gx + i, gy + j) for j, line in enumerate(P['shape']) for i, ch in enumerate(line) if ch == 'x']
                    ok = all(0 <= x < F and 0 <= y < F and lp[ox + x, oy + y][3] > 0
                             and fp[ox + x, oy + y] == lp[ox + x, oy + y]
                             and sum(lp[ox + x, oy + y][:3]) > 300  # не на контуре и тенях
                             # по краям сердечка тоже ткань, чтобы оно не касалось контура
                             and all(lp[ox + x + a, oy + y + b][3] > 0 and sum(lp[ox + x + a, oy + y + b][:3]) > 200
                                     for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + a < F and 0 <= y + b < F)
                             for x, y in cells)
                    if ok:
                        placed.append((gx, gy))
                        for x, y in cells:
                            fp[ox + x, oy + y] = HEART_SH if (x, y) == cells[-1] else HEART_C


SCLERA = (242, 247, 248)
# Лицо: улыбка (уголки вверх) и румянец. У голов LPC рта нет, а готовые «радостные» лица
# закрывают глаза — поэтому глаза оставляем открытыми и рисуем улыбку сами.
FACES = {
    # у неё розовые губы: верх по центру светлее, уголки и низ темнее
    'her': {'corner': (182, 60, 90), 'top': (232, 120, 138), 'bottom': (204, 78, 104), 'blush': (244, 160, 160)},
    # у него — тёмная линия улыбки и лёгкий румянец
    'him': {'corner': (124, 52, 52), 'top': None, 'bottom': (138, 60, 58), 'blush': (236, 160, 140)},
}


def draw_face(final, head, lpc, face):
    """Улыбка и румянец по положению глаз в каждом кадре; только поверх видимой кожи головы."""
    _, pal = lpc.palette('eye')
    eye = {hexrgb(c) for v in pal.values() for c in v} | {SCLERA}
    fp, hp = final.load(), head.load()
    W, H = final.size
    A = lambda c: c + (255,)
    for oy in range(0, H, F):
        for ox in range(0, W, F):
            pts = [(x, y) for y in range(F) for x in range(F)
                   if hp[ox + x, oy + y][3] > 0 and hp[ox + x, oy + y][:3] in eye]
            if not pts:
                continue  # вид сзади или пустой кадр
            xs = [p[0] for p in pts]
            eb = max(p[1] for p in pts)
            y = eb + 2
            x0, x1 = min(xs), max(xs)
            hx = [x for x in range(F) for yy in range(F) if hp[ox + x, oy + yy][3] > 0]
            mid = (min(hx) + max(hx)) / 2
            cells = []
            if x1 - x0 >= 5:                       # оба глаза — вид спереди
                c = (x0 + x1) // 2
                cells += [((c - 1, y), face['corner']), ((c + 2, y), face['corner']),
                          ((c, y + 1), face['bottom']), ((c + 1, y + 1), face['bottom'])]
                if face['top']:
                    cells += [((c, y), face['top']), ((c + 1, y), face['top'])]
                if face['blush']:
                    cells += [((x0, eb + 1), face['blush']), ((x1, eb + 1), face['blush'])]
            else:
                right = (x0 + x1) / 2 > mid
                s = 1 if right else -1
                e = x1 if right else x0            # передний край глаза
                cells += [((e - s, y), face['corner']), ((e, y + 1), face['bottom']), ((e + s, y + 1), face['bottom'])]
                if face['top']:
                    cells += [((e, y), face['top']), ((e + s, y), face['top'])]
                if face['blush']:
                    cells += [((e - 2 * s, eb + 1), face['blush'])]
            for (x, yy), col in cells:
                if 0 <= x < F and 0 <= yy < F and hp[ox + x, oy + yy][3] > 0 \
                        and fp[ox + x, oy + yy] == hp[ox + x, oy + yy]:
                    fp[ox + x, oy + yy] = A(col)


def eye_points(hp, ox, oy, eye):
    return [(x, y) for y in range(F) for x in range(F)
            if hp[ox + x, oy + y][3] > 0 and hp[ox + x, oy + y][:3] in eye]


def draw_fringe(final, head, lpc, cfg):
    """Чёлка во всех кадрах, где лицо смотрит на нас (видны оба глаза)."""
    _, hp_ = lpc.palette('hair')
    c = [hexrgb(x) + (255,) for x in hp_[cfg['colors']]]
    _, ep = lpc.palette('eye')
    eye = {hexrgb(x) for v in ep.values() for x in v} | {SCLERA}
    fp, hp = final.load(), head.load()
    W, H = final.size
    last = None
    for oy in range(0, H, F):
        for ox in range(0, W, F):
            head_px = [(x, y) for y in range(F) for x in range(F) if hp[ox + x, oy + y][3] > 0]
            if not head_px:
                continue
            top = min(y for _, y in head_px)
            left = min(x for x, _ in head_px)
            pts = eye_points(hp, ox, oy, eye)
            if pts:
                xs = [p[0] for p in pts]
                x0, x1 = min(xs), max(xs)
                if x1 - x0 < 5:
                    continue                               # профиль — чёлку не трогаем
                ey0 = min(p[1] for p in pts)
                last = (x0 - left, x1 - left, ey0 - top, oy)
            elif last and last[3] == oy:
                # глаза закрыты (заклинание и т.п.) — берём положение из прошлого кадра этой строки
                x0, x1, ey0 = left + last[0], left + last[1], top + last[2]
            else:
                continue
            mid = (x0 + x1) / 2
            for x in sorted({x for x, _ in head_px}):
                long_side = (x <= mid - 1) if cfg['side'] == 'left' else (x >= mid + 1)
                # её сторона: до верхнего края глаза (почти закрывает его); остальное — над бровями.
                # Край неровный: каждый третий столбец на пиксель короче.
                bottom = (ey0 if long_side else ey0 - 2) - (1 if x % 3 == 0 else 0)
                for y in range(top, bottom + 1):
                    p = fp[ox + x, oy + y]
                    if hp[ox + x, oy + y][3] == 0 or sum(p[:3]) < 200:
                        continue                           # уже волосы — оставляем их фактуру
                    if y == bottom:
                        k = 0                              # тёмный край чёлки
                    elif x % 3 == 0:
                        k = 1                              # тёмная прядь
                    elif x % 3 == 1 and y == bottom - 2:
                        k = 4                              # блик
                    else:
                        k = 2
                    fp[ox + x, oy + y] = c[k]


def draw_strands(final, head, hair_layers, lpc, cfg):
    """Две пряди по 3 пикселя от висков вниз поверх плеч (только вид спереди)."""
    _, pal = lpc.palette('hair')
    c = [hexrgb(x) + (255,) for x in pal[cfg['colors']]]   # от тёмного к светлому
    fp, hp = final.load(), head.load()
    hl = [h.load() for h in hair_layers]
    for folder, row, nrows, nfr, _, _ in ANIMS:
        if nrows != 4:
            continue
        oy = (row + 2) * F                                  # строка «вниз»
        for f in range(nfr):
            ox = f * F
            head_px = [(x, y) for y in range(F) for x in range(F) if hp[ox + x, oy + y][3] > 0]
            if not head_px:
                continue
            chin = max(y for _, y in head_px)
            y0 = chin - 4                                   # чуть выше подбородка, от прядей у лица
            row_hair = [x for x in range(F) if any(h[ox + x, oy + y0][3] > 0 for h in hl)]
            if not row_hair:
                continue
            left, right = min(row_hair), max(row_hair)
            for side, x_out in ((-1, left), (1, right)):
                xs = [x_out, x_out - side, x_out - 2 * side]   # снаружи → внутрь
                for i in range(cfg['len']):
                    y = y0 + i
                    taper = i >= cfg['len'] - 2                 # кончик сужается
                    for k, x in enumerate(xs):
                        if taper and k == 0 or (i == cfg['len'] - 1 and k == 1):
                            continue
                        if not (0 <= x < F and 0 <= y < F):
                            continue
                        # контур снаружи, середина — основной тон, блик внутри через ряд
                        col = c[0] if k == 0 else (c[4] if (k == 2 and i % 3 == 1) else c[2] if k == 1 else c[3])
                        fp[ox + x, oy + y] = col
                    # тёмный контур со стороны лица/футболки
                    xi = x_out - 3 * side
                    if 0 <= xi < F and 0 <= y < F and not taper and y > chin:
                        fp[ox + xi, oy + y] = c[0]


def build(lpc, kind, hero, credits):
    head = None
    hair_layers = []
    layers = []
    for spec in hero['layers']:
        d = lpc.definition(spec['def'])
        for z, sheet in layer_sheet(lpc, d, hero['body'], spec['colors'], hero.get('head')):
            layers.append((z, len(layers), sheet, spec.get('print')))
            if spec.get('lips'):
                head = sheet
            if spec['def'].startswith('hair/'):
                hair_layers.append(sheet)
        # Авторы только тех файлов, что реально использованы для этого телосложения.
        used = [d[k].get(hero['body'], '') for k in d if k.startswith('layer_')]
        for c in d.get('credits', []):
            if any(u.startswith(c['file'].rstrip('/') + '/') or u.rstrip('/') == c['file'].rstrip('/') for u in used):
                credits.setdefault(c['file'], c)
    layers.sort(key=lambda t: (t[0], t[1]))
    final = Image.new('RGBA', (SHEET_W, 54 * F), (0, 0, 0, 0))
    for _, _, sheet, _ in layers:
        final.alpha_composite(sheet)
    for _, _, sheet, pr in layers:
        if pr:
            heart_print(final, sheet, pr)
    if hero.get('strands') and head is not None:
        draw_strands(final, head, hair_layers, lpc, hero['strands'])
    if hero.get('fringe') and head is not None:
        draw_fringe(final, head, lpc, hero['fringe'])
    if head is not None and kind in FACES:
        draw_face(final, head, lpc, FACES[kind])
    final.save(os.path.join(OUT, f'{kind}_lpc.png'), optimize=True)
    return final


def preview(sheets):
    """Превью: покой во все 4 стороны, бег вправо, удар вниз — ×4."""
    cells = [('idle', 2, 0), ('idle', 3, 0), ('idle', 0, 0), ('idle', 1, 0),
             ('walk', 2, 2), ('run', 3, 2), ('slash', 2, 3), ('jump', 2, 2), ('hurt', 0, 3)]
    rows = {a[0]: a[1] for a in ANIMS}
    out = Image.new('RGBA', (len(cells) * F, len(sheets) * F), (0, 0, 0, 0))
    for j, s in enumerate(sheets):
        for i, (anim, d, f) in enumerate(cells):
            r = rows[anim] + (d if anim != 'hurt' else 0)
            out.alpha_composite(s.crop((f * F, r * F, f * F + F, r * F + F)), (i * F, j * F))
    out.resize((out.width * 4, out.height * 4), Image.NEAREST).save(os.path.join(ROOT, 'tools', 'lpc', 'preview_x4.png'))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    lpc = Lpc(sys.argv[1])
    os.makedirs(OUT, exist_ok=True)
    credits = {}
    sheets = [build(lpc, k, h, credits) for k, h in HEROES.items()]
    preview(sheets)
    atlas = {
        'frame': [F, F],
        'anchor': [32, 60],
        'layout': 'Universal LPC: строки по 4 направления (up, left, down, right), столбцы — кадры',
        'directions': DIRS,
        'sheets': {k: f'assets/lpc/{k}_lpc.png' for k in HEROES},
        'anims': {a[0]: {'row': a[1], 'dirs': a[2], 'frames': a[3], 'fps': a[4], 'loop': a[5]} for a in ANIMS},
    }
    with open(os.path.join(OUT, 'lpc_atlas.json'), 'w', encoding='utf-8') as f:
        json.dump(atlas, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'CREDITS-LPC.txt'), 'w', encoding='utf-8') as f:
        f.write('Спрайты героев собраны из Universal LPC Spritesheet Character Generator\n'
                'https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator\n'
                'Перекрашено и дополнено (принт сердечками) для игры «Вдвоём».\n'
                'Лицензии слоёв ниже; для совместного использования действуют самые строгие из них\n'
                '(CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0 — указывать авторов обязательно).\n\n')
        for file, c in sorted(credits.items()):
            f.write(f"{file}\n  Авторы: {', '.join(c['authors'])}\n  Лицензии: {', '.join(c['licenses'])}\n")
            for u in c.get('urls', []):
                f.write(f'  {u}\n')
            if c.get('notes'):
                f.write(f"  Примечание: {c['notes']}\n")
            f.write('\n')
    print('готово:', OUT)


if __name__ == '__main__':
    main()
