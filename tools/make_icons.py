# アプリアイコンを作る（直交表のマス目と、要因効果図の折れ線）。python tools/make_icons.py（Pillow が必要）
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'icons'
BG, WHITE, LIGHT, ORANGE = (29, 92, 150), (255, 255, 255), (120, 165, 205), (255, 168, 120)
# L4 直交表の水準（1 = 薄い、2 = 白）
L4 = [[1, 1, 1], [1, 2, 2], [2, 1, 2], [2, 2, 1]]

def draw(size, maskable=False):
    s = 4 * size  # 4 倍で描いて縮小（縁を滑らかにする）
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG); k = 0.72
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.2, fill=BG); k = 1.0
    c = s / 2
    cell = s * 0.11 * k; gap = s * 0.025 * k
    x0 = c - (3 * cell + 2 * gap) / 2 - s * 0.14 * k
    y0 = c - (4 * cell + 3 * gap) / 2
    for i, row in enumerate(L4):
        for j, v in enumerate(row):
            x = x0 + j * (cell + gap); y = y0 + i * (cell + gap)
            d.rounded_rectangle([x, y, x + cell, y + cell], radius=cell * 0.2, fill=WHITE if v == 2 else LIGHT)
    # 右側に要因効果図の折れ線
    px = c + s * 0.17 * k
    pts = [(px - s * 0.07 * k, c + s * 0.12 * k), (px, c - s * 0.02 * k), (px + s * 0.07 * k, c - s * 0.16 * k)]
    w = round(s * 0.03 * k)
    d.line(pts, fill=WHITE, width=w, joint='curve')
    r = s * 0.035 * k
    for i, (x, y) in enumerate(pts):
        d.ellipse([x - r, y - r, x + r, y + r], fill=ORANGE if i == 2 else WHITE)
    return im.resize((size, size), Image.LANCZOS)

OUT.mkdir(exist_ok=True)
draw(512).save(OUT / 'icon-512.png')
draw(192).save(OUT / 'icon-192.png')
draw(512, maskable=True).save(OUT / 'icon-maskable-512.png')
draw(180, maskable=True).convert('RGB').save(OUT / 'apple-touch-icon.png')
print('icons/ に書き出しました')
