#!/usr/bin/env python3
"""Собирает полный лист анимаций героя: виды спереди, сзади и сбоку.

Источник — исходные фронтальные кадры в tools/src (их не трогаем).
Лист: одна строка на анимацию, столбцы — кадры. Порядок строк и fps — в assets/*_atlas.json.
Вид спереди: исходные кадры + несколько производных (приземление, второй кадр прыжка и т.п.).
Вид сзади: те же кадры, лицо и принт заменены волосами и спиной.
Вид сбоку: голова на три четверти и туловище из исходника, тело в развороте: шаг в профиль,
наклон на бегу, волосы развеваются, прыжок по фазам.

Запуск из корня проекта: python3 tools/gen_hero_views.py
"""
import json
import math
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FW, FH = 32, 42
ARMS = True         # False: кадры без рук (лист «с оружием»: руки рисует игра по прицелу)
RUN_FRAMES = 12     # кадров в цикле бега (два шага), для всех видов одинаково
ATTACK_FRAMES = 6   # замах топором: подготовка, замах, удар, проводка, возврат (0,34 с, удар на 0,13 с = кадр 2)
FRONT_FRAMES = ['idle0', 'idle1', 'idle2', 'idle3', 'run0', 'run1', 'run2', 'run3', 'run4', 'run5',
                'jump', 'fall', 'dash', 'cast0', 'cast1', 'hurt', 'cheer']

# Палитры сняты с исходных спрайтов.
HEROES = {
    'her': {
        'kind': 'her', 'src': 'hero_front.png',
        'sheet': 'hero_sheet.png', 'atlas': 'hero_atlas.json', 'longHair': True,
        'pal': dict(o='#150d22', h='#141218', l='#3a3740', d='#09080b', s='#eab99d', S='#c98f78', e='#1b1020',
                    w='#ffffff', b='#f4a3a3', m='#d8586f', c='#f6e9d2', C='#e0cdac', p='#d9627f', P='#cf8fb2',
                    u='#7b5aa6', U='#5b4084', k='#f4efe9', K='#cfc6d4', t='#d98fb5', g='#4a4752'),
        'torso': ['c', 'C', 'P', 'p'],
        'print': ['P', 'p', '#ffb3c1'],
        # Одежда поверх исходника: шорты → белые штаны, кеды → белые кроссовки.
        'outfit': {
            'pants': '#f9f7f6', 'pantsShade': '#d9d3dd',
            'map': {'u': '#f9f7f6', 'U': '#d9d3dd', 'k': '#ffffff', 'K': '#c3c6d1', 't': '#ecedf2'},
        },
    },
    'him': {
        'kind': 'him', 'src': 'hero2_front.png',
        'sheet': 'hero2_sheet.png', 'atlas': 'hero2_atlas.json', 'longHair': False,
        'pal': dict(o='#0d0a14', h='#1f1a26', l='#4d4660', d='#120e18', s='#e9bf9f', S='#c4906f', e='#150f1a',
                    b='#cf9684', j='#1d1b22', J='#34313b', M='#2d2b37', n='#9b98a4', c='#f1f1f4', C='#cfcfd8',
                    O='#121016', u='#3a3f66', U='#262a47', k='#25232b', K='#4a4757', t='#e8e8ee', w='#ffffff'),
        'torso': ['j', 'J'],
        'print': ['c', 'C', 'n', 'J', 'M'],
        # Правки исходных кадров: в рывке у него не нарисовано бедро, и согнутая нога с кроссовком
        # висит в воздухе отдельно от тела. Дорисовываем бедро джинсами: строка -> {x: цвет палитры}.
        'fixes': {
            'dash': {
                30: {11: 'o', 12: 'o', 13: 'o'},
                31: {6: 'o', 7: 'o', 8: 'o', 9: 'o', 10: 'o', 11: 'u', 12: 'u', 13: 'u', 14: 'u'},
                32: {6: 'o', 7: 'u', 8: 'u', 9: 'u', 10: 'U', 11: 'U', 12: 'U', 13: 'U', 14: 'U'},
                33: {11: 'o', 12: 'o', 13: 'o', 14: 'o'},
            },
        },
    },
}


def hexrgb(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def torso_start(px, hero, default=None):
    """Первая строка туловища: не меньше 8 пикселей одежды (поднятые руки в рукавах уже)."""
    torso = {hexrgb(hero['pal'][k])[:3] for k in hero['torso']}
    for y in range(FH):
        if sum(1 for x in range(FW) if px[x, y][3] > 0 and px[x, y][:3] in torso) >= 8:
            return y
    return default


# ---------------- короткая стрижка (он): голова сзади и в повороте ----------------
def head_rows(px, hero, t0):
    """Строки головы: для каждой — (x0, x1) внутри контура, и строки, где есть лицо."""
    pal = hero['pal']
    outline = hexrgb(pal['o'])[:3]
    skin = {hexrgb(pal[k])[:3] for k in ('s', 'S', 'b', 'e')}
    hair = {hexrgb(pal[k])[:3] for k in ('h', 'l', 'd')}
    top = next(y for y in range(FH) if any(px[x, y][3] > 0 for x in range(FW)))
    # Ширина головы — по самой широкой строке волос: поднятые руки рядом с лицом не в счёт.
    hx = []
    for y in range(top, t0):
        xs = [x for x in range(FW) if px[x, y][3] > 0 and px[x, y][:3] in hair]
        if xs and max(xs) - min(xs) > (max(hx) - min(hx) if hx else -1):
            hx = xs
    lo, hi = (min(hx), max(hx)) if hx else (0, FW - 1)
    rows = {}
    for y in range(top, t0 - 1):
        xs = [x for x in range(lo, hi + 1) if px[x, y][3] > 0 and px[x, y][:3] != outline]
        if xs:
            rows[y] = (min(xs), max(xs))
    face = {}
    for y, (x0, x1) in rows.items():
        sx = [x for x in range(x0, x1 + 1) if px[x, y][:3] in skin]
        if len(sx) >= 4:  # строка с чёлкой (отдельные пиксели кожи) лицом не считается
            face[y] = (min(sx), max(sx))
    return top, rows, face


def back_short(front, hero):
    """Затылок: волосы до уровня ушей, ниже — гладкая шея без черт лица."""
    pal = hero['pal']
    im = front.copy()
    px = im.load()
    t0 = torso_start(px, hero)
    if t0 is None:
        return make_back(front, hero)
    top, rows, face = head_rows(px, hero, t0)
    hair, hi, dark = hexrgb(pal['h']), hexrgb(pal['l']), hexrgb(pal['d'])
    skin, shade = hexrgb(pal['s']), hexrgb(pal['S'])
    ys = sorted(rows)
    nape = ys[-1] - 2          # две нижние строки головы — шея
    for y in ys:
        x0, x1 = rows[y]
        for x in range(x0, x1 + 1):
            if px[x, y][3] == 0:
                continue
            if y < nape:
                strand = (x % 5 == 2 and top + 2 <= y <= top + 4) or (x % 6 == 4 and y == top + 6)  # пара бликов
                px[x, y] = dark if y == nape - 1 else (hi if strand else hair)
            else:
                px[x, y] = shade if x in (x0, x1) else skin
    # Спина куртки: без принта и молнии, шов посередине.
    prints = {hexrgb(pal[k])[:3] if len(k) == 1 else hexrgb(k)[:3] for k in hero['print']}
    base = hexrgb(pal['j'])
    for y in range(t0, FH):
        for x in range(FW):
            if px[x, y][3] > 0 and px[x, y][:3] in prints:
                px[x, y] = base
    js = [x for x in range(FW) if px[x, t0][3] > 0 and px[x, t0][:3] == base[:3]]
    if js:
        cx = (min(js) + max(js)) // 2
        for y in range(t0 + 2, t0 + 9):
            if px[cx, y][3] > 0 and px[cx, y][:3] == base[:3]:
                px[cx, y] = hexrgb(pal['M'])
    for x in range(FW):
        if px[x, t0][3] > 0 and px[x, t0][:3] == base[:3]:
            px[x, t0] = hexrgb(pal['J'])
    return im


def side_short(front, hero):
    """Поворот на три четверти: всё лицо (брови, глаза, нос, рот) целиком сдвигается вперёд,
    освободившееся место — волосы (выше линии волос) или тень щеки (ниже)."""
    pal = hero['pal']
    src = front.load()
    im = front.copy()
    px = im.load()
    outline = hexrgb(pal['o'])[:3]
    hair_cols = {hexrgb(pal[k])[:3] for k in ('h', 'l', 'd')}
    t0 = torso_start(src, hero)
    if t0 is None:
        return im
    top, rows, face = head_rows(src, hero, t0)
    hair, shade, skin = hexrgb(pal['h']), hexrgb(pal['S']), hexrgb(pal['s'])
    fc0 = min(f0 for f0, _ in face.values()) if face else 0
    fc1 = max(f1 for _, f1 in face.values()) if face else 0
    for y, (f0, f1) in face.items():
        x0, x1 = rows[y]
        has_hair_left = any(src[x, y][:3] in hair_cols for x in range(x0, f0))
        for x in range(f0, f1 + 1):
            px[x, y] = hair if has_hair_left else (shade if x == f0 else skin)
        # Ближняя половина лица сдвигается на FACE_SHIFT, дальняя — на пиксель меньше:
        # лицо чуть сужается, дальний глаз не прилипает к контуру головы.
        mid = (fc0 + fc1 + 1) // 2
        for x in list(range(mid, f1 + 1)) + list(range(f0, mid)):
            nx = x + (FACE_SHIFT if x < mid else FACE_SHIFT - 1)
            if nx > x1 or src[nx, y][3] == 0 or src[nx, y][:3] == outline:
                continue
            px[nx, y] = src[x, y]
    # Ухо на границе волос и лица, на уровне глаз.
    eye = hexrgb(pal['e'])[:3]
    eye_rows = sorted(y for y in face if any(src[x, y][:3] == eye for x in range(FW)))
    if eye_rows:
        ey = eye_rows[0]
        ex = face[ey][0] + FACE_SHIFT - 1
        for dy, col in enumerate(('S', 's', 'S')):
            if ey + dy in rows:
                px[ex, ey + dy] = hexrgb(pal[col])
                px[ex - 1, ey + dy] = hexrgb(pal['S'])
    return im


# ---------------- вид сзади ----------------
def make_back(front, hero):
    pal = hero['pal']
    torso = {hexrgb(pal[k])[:3] for k in hero['torso']}
    prints = {hexrgb(pal[k])[:3] if len(k) == 1 else hexrgb(k)[:3] for k in hero['print']}
    im = front.copy()
    px = im.load()
    # Первая строка туловища — граница головы.
    t0 = None
    for y in range(FH):
        if any(px[x, y][3] > 0 and px[x, y][:3] in torso for x in range(FW)):
            t0 = y
            break
    if t0 is None:
        return im
    hair, hi, dark = hexrgb(pal['h']), hexrgb(pal['l']), hexrgb(pal['d'])
    top = next(y for y in range(FH) if any(px[x, y][3] > 0 for x in range(FW)))
    # Голова: лицо закрываем волосами (у него ниже остаётся шея).
    neck_from = t0 - 1 if not hero['longHair'] else FH
    # Всё на голове, что не волосы и не обводка (лицо, рот, румянец, слёзы), становится волосами.
    keep = {hexrgb(pal[k])[:3] for k in ('h', 'l', 'd', 'o')} | ({hexrgb(pal['g'])[:3]} if 'g' in pal else set())
    hair_cols = {hexrgb(pal[k])[:3] for k in ('h', 'l', 'd')}
    for y in range(top, t0):
        # Только внутри головы: поднятые руки по бокам не трогаем.
        hx = [x for x in range(FW) if px[x, y][3] > 0 and px[x, y][:3] in hair_cols]
        if not hx:
            continue
        for x in range(min(hx), max(hx) + 1):
            c = px[x, y]
            if c[3] == 0 or c[:3] in keep:
                continue
            if y >= neck_from:
                continue
            # Пара прядей посередине, остальное — ровный цвет волос.
            strand = (x % 5 == 2) and top + 6 <= y <= top + 9
            px[x, y] = hi if strand else hair
    # Нижний ряд волос темнее — объём.
    for x in range(FW):
        y = (t0 - 2) if not hero['longHair'] else (t0 - 1)
        if px[x, y][3] > 0 and px[x, y][:3] == hair[:3]:
            px[x, y] = dark
    # Спина: убираем принт.
    base = hexrgb(pal['c'] if hero['longHair'] else pal['j'])
    for y in range(t0, FH):
        for x in range(FW):
            c = px[x, y]
            if c[3] > 0 and c[:3] in prints:
                px[x, y] = base
    if hero['longHair']:
        # Длинные волосы закрывают спину, к низу сужаются.
        shirt = {hexrgb(pal['c'])[:3], hexrgb(pal['C'])[:3]}
        for i, y in enumerate(range(t0, t0 + 9)):
            xs = [x for x in range(FW) if px[x, y][3] > 0 and px[x, y][:3] in shirt]
            if not xs:
                continue
            cx = (min(xs) + max(xs)) / 2
            half = 4.5 if i < 5 else (4.5 - (i - 4) * 1.1)
            if half <= 0:
                continue
            for x in xs:
                d = abs(x + 0.5 - cx)
                if d <= half:
                    edge = d > half - 1 and i >= 5
                    strand = x % 4 == 1 and 1 <= i <= 5
                    px[x, y] = dark if edge else (hi if strand else hair)
    else:
        # Шов на спине куртки и воротник.
        js = [x for x in range(FW) if px[x, t0][3] > 0 and px[x, t0][:3] == hexrgb(pal['j'])[:3]]
        if js:
            cx = (min(js) + max(js)) // 2
            for y in range(t0 + 2, t0 + 9):
                if px[cx, y][3] > 0 and px[cx, y][:3] == hexrgb(pal['j'])[:3]:
                    px[cx, y] = hexrgb(pal['M'])
        for x in range(FW):
            if px[x, t0][3] > 0 and px[x, t0][:3] == hexrgb(pal['j'])[:3]:
                px[x, t0] = hexrgb(pal['J'])
    return im


# ---------------- вид сбоку (поворот на три четверти) ----------------
# Не профиль: лицо с двумя глазами сдвигается в сторону взгляда, волосы уходят назад,
# у него сзади появляется ухо, принт на груди чуть смещается. Лицом вправо, влево — отражение.
FACE_SHIFT = 2


def make_side(front, hero):
    pal = hero['pal']
    torso = {hexrgb(pal[k])[:3] for k in hero['torso']}
    prints = {hexrgb(pal[k])[:3] if len(k) == 1 else hexrgb(k)[:3] for k in hero['print']}
    keep = {hexrgb(pal[k])[:3] for k in ('h', 'l', 'd', 'o')} | ({hexrgb(pal['g'])[:3]} if 'g' in pal else set())
    hair_cols = {hexrgb(pal[k])[:3] for k in ('h', 'l', 'd')}
    outline = hexrgb(pal['o'])[:3]
    hair = hexrgb(pal['h'])
    src = front.load()
    im = front.copy()
    px = im.load()
    t0 = next((y for y in range(FH) if any(src[x, y][3] > 0 and src[x, y][:3] in torso for x in range(FW))), None)
    if t0 is None:
        return im
    neck_from = t0 - 1 if not hero['longHair'] else FH

    # 1) Снимаем лицо в отдельный слой и закрашиваем его место волосами.
    face = {}
    for y in range(t0):
        if y >= neck_from:
            continue
        hx = [x for x in range(FW) if src[x, y][3] > 0 and src[x, y][:3] in hair_cols]
        if not hx:
            continue
        for x in range(min(hx), max(hx) + 1):
            c = src[x, y]
            if c[3] == 0 or c[:3] in keep:
                continue
            face[(x, y)] = c
            px[x, y] = hair
    if not face:
        return im
    # 2) Кладём лицо со сдвигом вперёд, не выходя за контур головы.
    for (x, y), c in face.items():
        nx = x + FACE_SHIFT
        if nx >= FW:
            continue
        d = src[nx, y]
        if d[3] == 0 or d[:3] == outline:
            continue
        px[nx, y] = c
    # 3) Ухо у него — на границе волос и лица, на уровне глаз.
    if not hero['longHair']:
        eye = hexrgb(pal['e'])[:3]
        eye_rows = sorted({y for (x, y), c in face.items() if c[:3] == eye})
        if eye_rows:
            ey = eye_rows[0]
            fx0 = min(x for (x, y) in face if y == ey) + FACE_SHIFT - 1
            for dy, col in enumerate(('S', 's', 'S')):
                px[fx0, ey + dy] = hexrgb(pal[col])
                px[fx0 - 1, ey + dy] = hexrgb(pal['S'])
    # 4) Принт на груди сдвигается на пиксель вперёд.
    base = hexrgb(pal['c'] if hero['longHair'] else pal['j'])
    moved = []
    for y in range(t0, 32):
        for x in range(FW - 1, -1, -1):
            c = src[x, y]
            if c[3] > 0 and c[:3] in prints:
                moved.append((x, y, c))
    for x, y, _ in moved:
        px[x, y] = base
    for x, y, c in moved:
        d = src[min(FW - 1, x + 1), y]
        if d[3] > 0 and (d[:3] in torso or d[:3] in prints):
            px[x + 1, y] = c
    return im


# ---------------- вид сбоку: тело в развороте, как на референсе ----------------
# Голова и туловище берутся из исходных кадров (голова уже повёрнута на три четверти),
# руки, ноги и волосы за спиной дорисовываются под позу: шаг в профиль, наклон на бегу,
# фазы прыжка. Обводка добавляется в конце.
class Layer:
    """Слой пикселей: ключ (x, y) -> RGBA."""
    def __init__(self, pal):
        self.pal = pal
        self.px = {}

    def put(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < FW and 0 <= y < FH:
            self.px[(x, y)] = hexrgb(self.pal[c]) if len(c) == 1 else hexrgb(c)

    def paste(self, items, dx=0, dy=0):
        for (x, y), c in items:
            if 0 <= x + dx < FW and 0 <= y + dy < FH:
                self.px[(x + dx, y + dy)] = c

    def outline(self):
        o = hexrgb(self.pal['o'])
        add = [(x, y) for y in range(FH) for x in range(FW) if (x, y) not in self.px
               and any((x + a, y + b) in self.px for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
        for p in add:
            self.px[p] = o

    def image(self):
        im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            im.putpixel((x, y), c)
        return im


def torso_row0(fr, hero):
    if not hero['longHair']:
        return torso_start(fr.load(), hero, 19)
    torso = {hexrgb(hero['pal'][k])[:3] for k in hero['torso']}
    px = fr.load()
    return next((y for y in range(FH) if any(px[x, y][3] > 0 and px[x, y][:3] in torso for x in range(FW))), 19)


def head_layer(fr34, hero):
    """Голова (3/4): всё выше туловища в пределах ширины головы (поднятые руки отсекаются),
    отцентрированная по x=16."""
    t0 = torso_row0(fr34, hero)
    px = fr34.load()
    pal = hero['pal']
    hair = {hexrgb(pal[k])[:3] for k in ('h', 'l', 'd')}
    best = []
    for y in range(t0):
        xs = [x for x in range(FW) if px[x, y][3] > 0 and px[x, y][:3] in hair]
        if xs and max(xs) - min(xs) > (max(best) - min(best) if best else -1):
            best = xs
    x0, x1 = (min(best) - 1, max(best) + 1) if best else (7, 24)
    dx = 16 - (x0 + x1 + 1) // 2
    out = []
    outline = hexrgb(pal['o'])[:3]
    for y in range(t0):
        if not hero['longHair']:
            # Только сплошной кусок строки вокруг центра головы: кулаки поднятых рук сбоку отбрасываем.
            c0 = c1 = (x0 + x1) // 2
            if px[c0, y][3] == 0:
                continue
            inside = lambda x: px[x, y][3] > 0 and px[x, y][:3] != outline
            while c0 - 1 >= x0 and inside(c0 - 1):
                c0 -= 1
            while c1 + 1 <= x1 and inside(c1 + 1):
                c1 += 1
            row = range(c0, c1 + 1)
        else:
            row = range(x0, x1 + 1)
        for x in row:
            # контур головы не копируем: Layer.outline() обведёт фигуру один раз, без двойной линии
            if px[x, y][3] > 0 and px[x, y][:3] != outline:
                out.append(((x + dx, y), px[x, y]))
    return out, t0


def torso_layer(fr34, hero, t0):
    """Туловище без рук и боковых прядей: узкая полоса по центру корпуса."""
    pal = hero['pal']
    px = fr34.load()
    drop = {hexrgb(pal[k])[:3] for k in ('o', 's', 'S', 'h', 'l', 'd')} | ({hexrgb(pal['g'])[:3]} if 'g' in pal else set())
    # Центр — по низу шорт/брюк.
    xs = [x for x in range(FW) if px[x, 30][3] > 0 and px[x, 30][:3] not in drop]
    cx = (min(xs) + max(xs) + 1) / 2 if xs else 16
    half_l, half_r = (5, 4) if hero['longHair'] else (4, 3)
    out = []
    for y in range(t0, 32):
        for x in range(int(cx - half_l), int(cx + half_r) + 1):
            c = px[x, y]
            if c[3] == 0 or c[:3] in drop:
                continue
            out.append(((x - int(cx) + 16, y), c))   # центр корпуса на x=16
    return out


def s_leg(L, hero, hx, fx, lift, far, y1=36):
    her = hero['longHair']
    ay = y1 - lift
    pts = []
    for y in range(32, ay + 1):
        t = (y - 32) / max(1, ay - 32)
        bend = math.sin(t * math.pi) * (1.3 if lift > 0 else 0.3)
        pts.append((hx + fx * t + bend, y))
    for (x, y) in pts:
        for dx in (-1, 0, 1):
            if her:
                c = 'k' if y == ay else ('S' if far or dx == 1 else 's')
            else:
                c = 'U' if far or dx == 1 else 'u'
            L.put(x + dx, y, c)
    ax = pts[-1][0]
    rows = ['k', 'k', 'K', 't'] if her else ['K', 'k', 'k', 't']
    for i, c in enumerate(rows):
        x1 = ax + 3 if i > 0 else ax + 1
        for x in range(int(round(ax - 1)), int(round(x1)) + 1):
            col = c
            if far:
                col = ('K' if c != 't' else 'K') if her else ('k' if c != 't' else 'K')
            L.put(x, ay + 1 + i, col)


def ik2(hx, hy, ax, ay, l1, l2, fwd):
    """Двухзвенная конечность: из плеча/бедра (hx, hy) в точку (ax, ay). Сустав (локоть/колено)
    смотрит вперёд при fwd=1 и назад при fwd=-1. Возвращает (сустав, достижимая конечная точка)."""
    dx, dy = ax - hx, ay - hy
    full = math.hypot(dx, dy) or 1e-6
    d = min(full, l1 + l2 - 0.05)
    ux, uy = dx / full, dy / full
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    nx, ny = -uy, ux
    if nx * fwd < 0:
        nx, ny = -nx, -ny
    return (hx + ux * a + nx * h, hy + uy * a + ny * h), (hx + ux * d, hy + uy * d)


def line_pts(p0, p1):
    n = max(1, int(math.ceil(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1])) * 2)))
    return [(p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n) for k in range(n + 1)]


def s_shoe(L, hero, ax, ay, far):
    her = hero['longHair']
    rows = ['k', 'k', 'K', 't'] if her else ['K', 'k', 'k', 't']
    for i, c in enumerate(rows):
        x1 = ax + 3 if i > 0 else ax + 1
        for x in range(int(round(ax - 1)), int(round(x1)) + 1):
            col = c
            if far:
                col = 'K' if her else ('k' if c != 't' else 'K')
            L.put(x, ay + 1 + i, col)


GROUND = 36   # строка щиколотки на земле (ниже — кроссовок)


def s_leg_ik(L, hero, hx, hy, fx, lift, far):
    """Нога с коленом: бедро и голень толщиной в три пикселя, колено вперёд, кроссовок на щиколотке."""
    knee, ank = ik2(hx, hy, hx + fx, GROUND - lift, 3.4, 3.4, 1)
    for p0, p1 in (((hx, hy), knee), (knee, ank)):
        steep = abs(p1[1] - p0[1]) >= abs(p1[0] - p0[0])
        for x, y in line_pts(p0, p1):
            for k in (-1, 0, 1):
                px, py = (x + k, y) if steep else (x, y + k)
                # Цвет штанов (у неё 'u'/'U' потом перекрашиваются в белые штаны) — не кожа, чтобы бедро не просвечивало.
                L.put(px, py, 'U' if far or k == 1 else 'u')
    s_shoe(L, hero, ank[0], int(round(ank[1])), far)


def s_arm_ik(L, hero, sx, sy, hx, hy, far):
    """Рука с локтем назад: рукав до запястья, затем кулачок."""
    if not ARMS:
        return
    her = hero['longHair']
    elbow, hand = ik2(sx, sy, hx, hy, 3.2, 3.2, -1)
    pts = line_pts((sx, sy), elbow) + line_pts(elbow, hand)[1:]
    for i, (x, y) in enumerate(pts):
        sleeve = (i < len(pts) * 0.45) if her else (i < len(pts) - 2)
        if sleeve:
            c, c2 = (('C', 'C') if far else ('c', 'C')) if her else (('j', 'j') if far else ('J', 'M'))
        else:
            c, c2 = ('S', 'S') if far else ('s', 'S')
        L.put(x, y, c); L.put(x + 1, y, c2)
    hx, hy = int(round(hand[0])), int(round(hand[1]))
    L.put(hx, hy + 1, 'S' if far else 's'); L.put(hx + 1, hy + 1, 'S'); L.put(hx, hy + 2, 'S')


def s_arm(L, hero, sx, sy, hx, hy, far):
    if not ARMS:
        return
    her = hero['longHair']
    n = max(abs(hx - sx), abs(hy - sy), 1)
    pts = [(sx + (hx - sx) * i / n, sy + (hy - sy) * i / n) for i in range(int(n) + 1)]
    for i, (x, y) in enumerate(pts):
        sleeve = (i < 3) if her else (i < len(pts) - 1)
        if sleeve:
            c, c2 = (('C', 'C') if far else ('c', 'C')) if her else (('j', 'j') if far else ('J', 'M'))
        else:
            c, c2 = ('S', 'S') if far else ('s', 'S')
        L.put(x, y, c); L.put(x + 1, y, c2)
    # Кулачок.
    L.put(hx, hy + 1, 'S' if far else 's'); L.put(hx + 1, hy + 1, 'S'); L.put(hx, hy + 2, 'S')


def s_hair_back(L, top, sway, lean):
    """Длинные волосы за спиной, на бегу развеваются назад."""
    for y in range(top, top + 14):
        rel = y - top
        w = 5 if rel < 8 else max(1, 5 - (rel - 7) * 1.0)
        back = sway * rel / 13  # чем ниже, тем сильнее относит назад
        x1 = 13 + lean
        for x in range(int(round(x1 - w - back)), x1 + 1):
            c = 'h'
            if x % 3 == 0 and 2 <= rel < 10 and rel % 4 != 0:
                c = 'l'
            if rel >= 11 or x == int(round(x1 - w - back)):
                c = 'd'
            L.put(x, y, c)


STRIDE = 3.2


def gait_foot(u, stride=STRIDE, lift=3.6):
    """Стопа бегущего относительно бедра: (вынос вперёд, высота над землёй). Опора: стопа едет назад по земле;
    мах: отрывается, уходит назад-вверх и возвращается вперёд."""
    u %= 1
    if u < 0.4:
        return stride * (1 - 2 * u / 0.4), 0.0
    t = (u - 0.4) / 0.6
    e = t * t * (3 - 2 * t)
    return -stride + 2 * stride * e, lift * math.sin(math.pi * t) ** 0.8


SPEED_LINES = [(-9, 22, 4), (-11, 26, 5), (-8, 30, 3)]


def side_pose(anim, i, n):
    P = dict(bob=0, lean=0, head_dx=0, near=(1, 0), far=(-1, 0), hn=(1, 27), hf=(-1, 27), sway=0, lines=False, arm_up=False)
    if anim == 'idle':
        b = [0, 0, 1, 1][i]
        P.update(bob=b, hn=(1, 27 + b), hf=(-1, 27 + b))
    elif anim == 'walk':
        # Шаг: короче и ниже, чем бег, без наклона вперёд; цикл из двух шагов, как у бега.
        u = i / n
        low = abs(((u * 2) % 1) - 0.4) <= 0.2
        P.update(bob=0 if low else -1, lean=0, head_dx=0, sway=1 + abs(math.sin(u * math.pi * 2)) * 0.5, gait=u, walk=True)
    elif anim == 'run':
        # Цикл из двух шагов: gait — фаза ближней ноги (0..1), дальняя отстаёт на полцикла.
        u = i / n
        low = abs(((u * 2) % 1) - 0.4) <= 0.2    # середина опоры: корпус пружинит вниз
        P.update(bob=0 if low else -1, lean=1, head_dx=2, sway=3 + abs(math.sin(u * math.pi * 2)), gait=u)
    elif anim == 'jump':
        # 0 — толчок (присед), 1 — взлёт с поднятой рукой.
        if i == 0:
            P.update(bob=2, lean=1, near=(3, 0), far=(-2, 0), hn=(-3, 28), hf=(-4, 28), sway=1)
        else:
            P.update(bob=-2, lean=0, near=(2, 4), far=(-2, 2), hn=(8, 9), hf=(-6, 24), sway=-2, arm_up=True)
    elif anim == 'fall':
        P.update(bob=-1, near=(2, 1 + i), far=(-3, i), hn=(4, 21 - i), hf=(-4, 21 + i), sway=-3)
    elif anim == 'land':
        P.update(bob=2, near=(3, 0), far=(-3, 0), hn=(3, 28), hf=(-2, 29), sway=1)
    elif anim == 'dash':
        P.update(lean=2, head_dx=1, near=(6 - i, 1), far=(-6 + i, 0), hn=(-5, 25), hf=(-4, 26), sway=5, lines=True)
    elif anim == 'hurt':
        P.update(lean=-1, head_dx=-1 - i, near=(-1, 0), far=(-3, 0), hn=(-3, 22), hf=(2, 22), bob=i, sway=-1)
    elif anim == 'cheer':
        P.update(bob=-2 * i, near=(1, i * 2), far=(-1, i * 2), hn=(8, 10 - 2 * i), hf=(-4, 11 - 2 * i), arm_up=True)
    elif anim == 'cast':
        # Замах топором (6 кадров): подготовка, замах назад-вверх, выпад с ударом, проводка, возврат.
        T = dict(
            lean=(-1, -2, 3, 2, 1, 0), bob=(0, 1, 1, 1, 0, 0), head_dx=(0, -1, 1, 1, 0, 0),
            near=((-1, 0), (-2, 0), (5, 0), (4, 0), (2, 0), (0, 0)),
            far=((1, 0), (2, 0), (-3, 0), (-3, 0), (-1, 0), (0, 0)),
            hn=((-8, 15), (-10, 11), (9, 25), (9, 28), (6, 28), (2, 27)),
            hf=((-6, 15), (-8, 12), (6, 22), (6, 26), (4, 27), (-1, 27)),
        )
        P.update({k: v[i] for k, v in T.items()}, arm_up=i < 2)
    return P


KEYED = {'jump': False, 'fall': True, 'dash': False, 'cheer': True}  # анимация -> зациклена ли


def lerp_pose(a, b, u):
    out = {}
    for k, va in a.items():
        vb = b[k]
        if isinstance(va, tuple):
            out[k] = tuple(rnd(x + (y - x) * u) for x, y in zip(va, vb))
        elif isinstance(va, bool):
            out[k] = vb if u >= 0.5 else va
        else:
            out[k] = rnd(va + (vb - va) * u)
    return out


def side_pose_at(anim, i, n):
    """Позы из двух ключевых кадров (прыжок, падение, рывок...) плавно переходят друг в друга;
    бег считается по фазе, покой и остальное — как раньше."""
    if anim in KEYED and n > 2:
        # зацикленные идут туда и обратно (0, ½, 1, ½), остальные — от первой позы к последней
        u = [0, 0.5, 1, 0.5][i] if KEYED[anim] else i / (n - 1)
        return lerp_pose(side_pose(anim, 0, 2), side_pose(anim, 1, 2), u)
    return side_pose(anim, i, n)


def make_side_body(hero, anim, i, n, head_fr, torso_fr):
    """Кадр вида сбоку: голова (3/4) и туловище из исходника, конечности по позе."""
    P = side_pose_at(anim, i, n)
    if hero['longHair']:
        # Тяжёлые длинные волосы не должны выдвигать голову вперёд корпуса: она стоит над плечами.
        P['head_dx'] = min(P['head_dx'], 0)
    h34 = (make_side if hero['longHair'] else side_short)(head_fr, hero)
    head, t0 = head_layer(h34, hero)
    # Туловище из исходного кадра как есть: принт не искажаем.
    torso = torso_layer(torso_fr, hero, torso_row0(torso_fr, hero))
    L = Layer(hero['pal'])
    bob, lean = P['bob'], P['lean']
    hip = 16 + lean
    shx, shy = 18 + lean, 20 + bob   # ближнее плечо — у переднего края корпуса
    if P['lines']:
        for dx, y, ln in SPEED_LINES:
            for k in range(ln):
                L.put(16 + dx - k, y + bob, '#dfe8ff')
    gait = P.get('gait')
    hip_y = 31 + bob
    if gait is not None:
        # Руки машут навстречу ногам: вперёд рука поднимается, назад опускается.
        sw = -math.cos(gait * math.pi * 2)
        walk = P.get('walk')
        stride, lift_max = (2.2, 2.0) if walk else (STRIDE, 3.6)
        arm_hand = lambda a: ((2.8 if walk else 4.2) * a, 5 - (1 if walk else 2) * max(0, a))
        fa = arm_hand(-sw)
        s_arm_ik(L, hero, shx - 6, shy, shx - 6 + fa[0], shy + fa[1], far=True)
    else:
        s_arm(L, hero, shx - 6, shy, shx - 6 + P['hf'][0], P['hf'][1], far=True)
    if hero['longHair']:
        s_hair_back(L, 15 + bob, P['sway'], lean)
    if gait is not None:
        fx, fl = gait_foot(gait + 0.5, stride, lift_max)
        s_leg_ik(L, hero, hip - 2, hip_y, fx, fl, far=True)
    else:
        s_leg(L, hero, hip - 2, P['far'][0], P['far'][1], far=True)
    # Туловище: на бегу верх чуть впереди низа — наклон.
    for (x, y), c in torso:
        tilt = lean if y < 26 else max(0, lean - 1)
        L.paste([((x, y), c)], tilt, bob)
    if gait is not None:
        fx, fl = gait_foot(gait, stride, lift_max)
        s_leg_ik(L, hero, hip, hip_y, fx, fl, far=False)
    else:
        s_leg(L, hero, hip, P['near'][0], P['near'][1], far=False)
    if P['arm_up']:
        s_arm(L, hero, shx, shy + 1, shx + P['hn'][0], P['hn'][1], far=False)
    L.paste(head, lean + P['head_dx'], bob)
    if gait is not None:
        na = arm_hand(sw)
        s_arm_ik(L, hero, shx, shy + 1, shx + na[0], shy + 1 + na[1], far=False)
    elif not P['arm_up']:
        s_arm(L, hero, shx, shy + 1, shx + P['hn'][0], P['hn'][1], far=False)
    L.outline()
    return L.image()


SIDE_COUNTS = {'idle': 4, 'walk': RUN_FRAMES, 'run': RUN_FRAMES, 'jump': 3, 'fall': 4, 'land': 1, 'dash': 3, 'hurt': 2, 'cheer': 4, 'cast': ATTACK_FRAMES}
SIDE_HEAD = {'idle': None, 'walk': 'idle0', 'run': 'idle0', 'jump': 'jump', 'fall': 'fall', 'land': 'idle0', 'dash': 'dash',
             'hurt': 'hurt', 'cheer': 'cheer', 'cast': 'idle0'}


def side_anims(src, hero):
    f = {n: src.crop((i * FW, 0, (i + 1) * FW, FH)) for i, n in enumerate(FRONT_FRAMES)}
    out = {}
    for anim, n in SIDE_COUNTS.items():
        frames = []
        for i in range(n):
            head_name = SIDE_HEAD[anim] or 'idle%d' % i   # покой: моргание из исходных кадров
            frames.append(make_side_body(hero, anim, i, n, f[head_name], f['idle0']))
        out[anim] = frames
    return out


# ---------------- вид спереди: дополнительные кадры из исходных ----------------
def layers(fr, hero):
    """Делит кадр на голову, туловище с руками и ноги."""
    pal = hero['pal']
    torso = {hexrgb(pal[k])[:3] for k in hero['torso']}
    px = fr.load()
    t0 = next((y for y in range(FH) if any(px[x, y][3] > 0 and px[x, y][:3] in torso for x in range(FW))), 19)
    head, body, legs = (Image.new('RGBA', (FW, FH), (0, 0, 0, 0)) for _ in range(3))
    head.paste(fr.crop((0, 0, FW, t0)), (0, 0))
    body.paste(fr.crop((0, t0, FW, 32)), (0, t0))
    legs.paste(fr.crop((0, 32, FW, FH)), (0, 32))
    return head, body, legs


def compose(parts):
    out = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    for im, dx, dy in parts:
        out.alpha_composite(shift(im, dx, dy))
    return out


def shift(im, dx, dy):
    out = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    out.paste(im, (dx, dy), im)
    return out




def front_attack(f, hero):
    """Удар спереди и сзади. Корпус приседает в замахе и бросается вперёд в ударе (вниз по кадру),
    ноги расставляются шире. Руки берутся из исходных кадров заклинания. Корпус только опускается,
    поэтому между ним и ногами нет щели."""
    idle, _, _ = split_idle(f['idle0'])
    c0, _, _ = split_idle(f['cast0'])
    c1, _, _ = split_idle(f['cast1'])
    _, left, right = split_idle(f['idle0'])
    plan = [  # (корпус, смещение по высоте, расставить ноги)
        (idle, 0, 0), (c0, 1, 1), (c1, 2, 1), (c1, 1, 1), (c0, 0, 0), (idle, 0, 0),
    ]
    return [compose([(left, -w, 0), (right, w, 0), (body, 0, dy)]) for body, dy, w in plan]


def top_row(im):
    return next((y for y in range(FH) if any(im.getpixel((x, y))[3] > 0 for x in range(FW))), 0)


def center_x(im):
    xs = [x for y in range(FH) for x in range(FW) if im.getpixel((x, y))[3] > 0]
    return sum(xs) / len(xs) if xs else FW / 2


def rnd(v):
    return int(math.floor(v + 0.5))


def tween(a, b, t, hero):
    """Промежуточный кадр между a и b: голова с туловищем смещаются по высоте, ноги и руки —
    по горизонтали на долю t от разницы поз. Формы берутся из a, поэтому пиксели остаются чистыми."""
    ha, ba, la = layers(a, hero)
    hb, bb, lb = layers(b, hero)
    dy = rnd((top_row(hb) - top_row(ha)) * t)
    bdx = max(-1, min(1, rnd((center_x(bb) - center_x(ba)) * t)))
    ldx = max(-2, min(2, rnd((center_x(lb) - center_x(la)) * t)))
    return compose([(la, ldx, 0), (ba, bdx, dy), (ha, bdx, dy)])


def smooth(frames, hero, cyclic):
    """Между соседними кадрами вставляет по одному промежуточному (у зацикленных — и между последним и первым)."""
    n = len(frames)
    out = []
    for i, fr in enumerate(frames):
        out.append(fr)
        if i < n - 1 or cyclic:
            out.append(tween(fr, frames[(i + 1) % n], 0.5, hero))
    return out


def split_idle(fr):
    """Кадр покоя -> (туловище с головой, левая нога с кроссовком, правая). В покое кроссовки нарисованы
    одним куском, делим их по центру: ноги можно двигать по отдельности."""
    px = fr.load()
    body = fr.copy()
    bp = body.load()
    legs = [Image.new('RGBA', (FW, FH), (0, 0, 0, 0)) for _ in range(2)]
    for y in range(32, FH):
        spans = ((11, 15), (16, 20)) if y < 37 else ((10, 15), (16, 21))
        for leg, (x0, x1) in zip(legs, spans):
            for x in range(x0, x1 + 1):
                leg.putpixel((x, y), px[x, y])
                bp[x, y] = (0, 0, 0, 0)
    return body, legs[0], legs[1]




def front_run(idle, hero, n=RUN_FRAMES, amp=3):
    """Бег на камеру: корпус и голова из покоя, ноги по очереди подтягиваются под тело,
    корпус пружинит на каждом шаге. Все кадры собраны из одних и тех же кусков, поэтому ноги
    не отрываются от тела."""
    body, left, right = split_idle(idle)
    out = []
    for i in range(n):
        ph = i / n
        lifts = []
        for u in (ph, (ph + 0.5) % 1):
            lifts.append(rnd(amp * math.sin(math.pi * (u - 0.5) / 0.5)) if u >= 0.5 else 0)
        s = (ph * 2) % 1
        dy = 1 if abs(s - 0.5) <= 0.2 else 0     # самая низкая точка: над опорной ногой проходит махнувшая
        out.append(compose([
            (left, -1 if lifts[0] >= 2 else 0, -lifts[0]),
            (right, 1 if lifts[1] >= 2 else 0, -lifts[1]),
            (body, 0, dy),
        ]))
    return out


def front_anims(src, hero):
    f = {n: src.crop((i * FW, 0, (i + 1) * FW, FH)) for i, n in enumerate(FRONT_FRAMES)}
    for name, rows in hero.get('fixes', {}).items():
        px = f[name].load()
        for y, cells in rows.items():
            for x, key in cells.items():
                px[x, y] = hexrgb(hero['pal'][key])

    def lay(n):
        return layers(f[n], hero)

    h, b, l = lay('idle0')
    land = compose([(l, 0, 0), (b, 0, 1), (h, 0, 1)])           # присел: верх опустился на ноги
    jh, jb, jl = lay('jump')
    jump1 = compose([(jl, 0, -1), (jb, 0, 0), (jh, 0, 0)])       # ноги подтянуты
    fh, fb, fl = lay('fall')
    fall1 = compose([(fl, 0, 0), (fb, 0, 1), (fh, 0, 1)])        # покачивание в воздухе
    dh, db, dl = lay('dash')
    dash1 = compose([(dl, 0, 0), (db, 0, 0), (dh, 0, 1)])        # голова пружинит
    s = lambda frames, cyclic: smooth(frames, hero, cyclic)
    return {
        'idle': [f['idle0'], f['idle1'], f['idle2'], f['idle3']],   # медленное дыхание и моргание: без вставок
        'walk': front_run(f['idle0'], hero, amp=2),
        'run': front_run(f['idle0'], hero),
        'jump': s([f['jump'], jump1], False),
        'fall': s([f['fall'], fall1], True),
        'land': [land],
        'dash': s([f['dash'], dash1], False),
        'hurt': [f['hurt'], shift(f['hurt'], 1, 0)],                # дрожь: резкая, вставки не нужны
        'cheer': s([f['cheer'], shift(f['cheer'], 0, -2)], True),   # подпрыгивает от радости
        'cast': front_attack(f, hero),
    }


# ---------------- её одежда: белые штаны с сердечками и белые кроссовки ----------------
# Исходные кадры нарисованы в шортах и кедах. Поверх готового листа: шорты и голые ноги
# становятся длинными белыми штанами (по сердечку на штанине), кеды — белыми кроссовками
# в духе Air Force 1 (белый верх, серая полоска над подошвой, светлая подошва; без логотипа).
LEGS_FROM = 31          # ниже этой строки кадра кожа — только ноги (кисти рук выше)
LEGS_X = (9, 23)


def dress(sheet, hero):
    pal, out = hero['pal'], hero['outfit']
    rgb = lambda k: hexrgb(pal[k])[:3]
    recolor = {rgb(k): hexrgb(v) for k, v in out['map'].items()}
    leg_skin = {rgb('s'): hexrgb(out['pants']), rgb('S'): hexrgb(out['pantsShade'])}
    pants = hexrgb(out['pants'])
    heart = hexrgb(pal['p'])
    px = sheet.load()
    W, H = sheet.size
    for fy in range(0, H, FH):
        for fx in range(0, W, FW):
            for y in range(FH):
                for x in range(FW):
                    c = px[fx + x, fy + y]
                    if c[3] == 0:
                        continue
                    if c[:3] in recolor:
                        px[fx + x, fy + y] = recolor[c[:3]]
                    elif c[:3] in leg_skin and y >= LEGS_FROM and LEGS_X[0] <= x <= LEGS_X[1]:
                        px[fx + x, fy + y] = leg_skin[c[:3]]
            # Сердечко на каждой штанине: белый пиксель, окружённый белым, ближе к колену.
            for tx in (13, 18):
                best = None
                for y in range(LEGS_FROM + 2, FH - 3):
                    for x in range(tx - 3, tx + 4):
                        if all(px[fx + x + a, fy + y + b] == pants for a, b in ((0, 0), (1, 0), (-1, 0))):
                            d = abs(x - tx) + abs(y - 34)
                            if best is None or d < best[0]:
                                best = (d, x, y)
                if best:
                    px[fx + best[1], fy + best[2]] = heart


# Порядок анимаций, базовая скорость (кадров в секунду) и зацикленность — общие для всех видов.
# Базовая скорость задана для исходного числа кадров (BASE_FRAMES); у кадров со вставками fps растёт
# пропорционально, так что длительность анимации прежняя, а движение плавнее.
ANIMS = [
    ('idle', 4, True), ('walk', 10, True), ('run', 15, True), ('jump', 10, False), ('fall', 8, True), ('land', 12, False),
    ('dash', 14, False), ('hurt', 14, True), ('cheer', 5, True), ('cast', 18, False),
]


BASE_FRAMES = {'idle': 4, 'walk': 6, 'run': 6, 'jump': 2, 'fall': 2, 'land': 1, 'dash': 2, 'hurt': 2, 'cheer': 2, 'cast': ATTACK_FRAMES}


def strip_arms(fr, hero):
    """Кадр спереди или сзади без рук: у него всё, что левее и правее корпуса ниже плеч; у неё кожа
    рук и кистей (заливается цветом волос). Руки вместо них рисует игра: они держат оружие."""
    out = fr.copy()
    px = out.load()
    pal = hero['pal']
    t0 = torso_row0(fr, hero)
    if not hero['longHair']:
        for y in range(t0 + 1, 32):
            for x in range(FW):
                if (x <= 11 or x >= 20) and px[x, y][3] > 0:
                    px[x, y] = (0, 0, 0, 0)
    else:
        skin = {hexrgb(pal['s'])[:3], hexrgb(pal['S'])[:3]}
        hair = hexrgb(pal['h'])
        for y in range(t0 + 3, 31):
            for x in range(FW):
                if px[x, y][3] > 0 and px[x, y][:3] in skin:
                    px[x, y] = hair
    return out


def assemble(views, hero):
    cols = max(len(frs) for v in views.values() for frs in v.values())
    rows = len(views) * len(ANIMS)
    sheet = Image.new('RGBA', (cols * FW, rows * FH), (0, 0, 0, 0))
    meta_views = {}
    row = 0
    for vname in ('front', 'back', 'side'):
        meta_views[vname] = {}
        for anim, fps, loop in ANIMS:
            frs = views[vname][anim]
            for i, fr in enumerate(frs):
                sheet.paste(fr, (i * FW, row * FH))
            fps = rnd(fps * len(frs) / BASE_FRAMES[anim])
            meta_views[vname][anim] = {'row': row, 'frames': len(frs), 'fps': fps, 'loop': loop}
            row += 1
    if hero.get('outfit'):
        dress(sheet, hero)
    return sheet, meta_views


def build(kind):
    hero = HEROES[kind]
    src = Image.open(ROOT / 'tools' / 'src' / hero['src']).convert('RGBA')
    front = front_anims(src, hero)
    views = {
        'front': front,
        'back': {a: [(make_back if hero['longHair'] else back_short)(fr, hero) for fr in frs] for a, frs in front.items()},
        'side': side_anims(src, hero),
    }
    sheet, meta_views = assemble(views, hero)
    sheet.save(ROOT / 'assets' / hero['sheet'])
    # Лист «с оружием»: те же кадры и раскладка, но без рук на теле.
    global ARMS
    ARMS = False
    try:
        side_free = side_anims(src, hero)
    finally:
        ARMS = True
    armed = {
        'front': {a: [strip_arms(fr, hero) for fr in frs] for a, frs in views['front'].items()},
        'back': {a: [strip_arms(fr, hero) for fr in frs] for a, frs in views['back'].items()},
        'side': side_free,
    }
    sheet_armed, _ = assemble(armed, hero)
    sheet_armed.save(ROOT / 'assets' / hero['sheet'].replace('_sheet', '_sheet_armed'))
    atlas = {
        'frame': [FW, FH],
        'anchor': [16, 40],
        'layout': 'one row per animation; columns are frames; views: front, back, side (3/4 turn facing right, flip for left)',
        'views': meta_views,
        'portrait_size': [44, 44],
        'portraits': ['neutral', 'smile', 'happy', 'wink', 'hurt', 'surprised'],
    }
    (ROOT / 'assets' / hero['atlas']).write_text(json.dumps(atlas, ensure_ascii=False, indent=1) + '\n')
    print(kind, 'ok', sheet.size)


if __name__ == '__main__':
    for k in HEROES:
        build(k)
