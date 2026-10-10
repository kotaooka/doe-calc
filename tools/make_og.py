# SNS 用の画像 og.png（1200×630）を作る。python tools/make_og.py [太字フォント] [標準フォント]
# 既定は Noto Sans CJK JP（.ttc の中の JP の字体を使う）。Pillow が必要
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BOLD = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
REG = sys.argv[2] if len(sys.argv) > 2 else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
W, H = 1200, 630
TOP, BOT = (31, 96, 154), (26, 72, 120)
WHITE, SUB, LINE, ORANGE, GREEN = (255, 255, 255), (214, 228, 242), (150, 185, 215), (255, 168, 120), (120, 210, 150)

def font(path, size):
    # .ttc の 0 番目は JP の字体
    return ImageFont.truetype(path, size, index=0)

im = Image.new('RGB', (W, H))
d = ImageDraw.Draw(im)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOT)))
d.text((72, 98), 'QC Workbench', font=font(REG, 30), fill=SUB)
d.text((70, 138), '実験計画法', font=font(BOLD, 76), fill=WHITE)
for i, line in enumerate(['直交表への割り付けから', '分散分析・SN比・最適条件の推定まで']):
    d.text((72, 246 + i * 44), line, font=font(REG, 30), fill=SUB)
chips = [['直交表 L4〜L18', '擬水準法'], ['SN比', '2 段階設計', '確認実験']]
f = font(REG, 24)
for r, row in enumerate(chips):
    x = 72
    for t in row:
        w = d.textlength(t, font=f) + 40
        d.rounded_rectangle([x, 360 + r * 58, x + w, 404 + r * 58], radius=22, outline=LINE, width=2)
        d.text((x + 20, 368 + r * 58), t, font=f, fill=WHITE)
        x += w + 14

# 右側：要因効果図（3 因子 × 3 水準）
x0, x1, y0, y1 = 730, 1120, 150, 470
d.line([(x0, y1), (x1, y1)], fill=LINE, width=2)
mean_y = (y0 + y1) / 2 + 10
for x in range(x0, x1, 14):
    d.line([(x, mean_y), (x + 7, mean_y)], fill=LINE, width=2)
# 凡例（グラフの上）
for x in range(x1 - 170, x1 - 130, 14):
    d.line([(x, y0 - 24), (x + 7, y0 - 24)], fill=LINE, width=2)
d.text((x1 - 122, y0 - 39), '全体の平均', font=font(REG, 22), fill=SUB)
panels = [[0.35, 0.55, 0.62], [0.15, 0.45, 0.95], [0.5, 0.42, 0.48]]
pw = (x1 - x0) / 3
for i, vals in enumerate(panels):
    if i:
        d.line([(x0 + i * pw, y0), (x0 + i * pw, y1)], fill=(70, 120, 170), width=2)
    pts = [(x0 + i * pw + pw * (j + 0.5) / 3, y1 - 20 - v * (y1 - y0 - 40)) for j, v in enumerate(vals)]
    d.line(pts, fill=WHITE if i < 2 else LINE, width=6, joint='curve')
    best = max(range(3), key=lambda j: vals[j])
    for j, (x, y) in enumerate(pts):
        r = 11 if j == best and i < 2 else 8
        d.ellipse([x - r, y - r, x + r, y + r], fill=ORANGE if j == best and i < 2 else (WHITE if i < 2 else LINE))
for i, t in enumerate(['A', 'B', 'C']):
    d.text((x0 + i * pw + pw / 2 - 8, y1 + 12), t, font=font(BOLD, 26), fill=SUB)
im.save(ROOT / 'og.png', optimize=True)
print('og.png を書き出しました')
