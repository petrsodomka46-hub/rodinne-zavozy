"""Vygeneruje ikony aplikace do složky icons/ (spustit: python tools/make_icons.py)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BLUE = (37, 99, 235)
BLUE_DARK = (29, 78, 216)
WHITE = (255, 255, 255)
YELLOW = (250, 204, 21)


def draw_icon(size: int, pad: float) -> Image.Image:
    s = 1024
    img = Image.new("RGB", (s, s), BLUE)
    d = ImageDraw.Draw(img)
    for y in range(s):  # jemný přechod
        t = y / s
        c = tuple(int(BLUE[i] * (1 - t) + BLUE_DARK[i] * t) for i in range(3))
        d.line([(0, y), (s, y)], fill=c)

    k = 1 - 2 * pad  # zmenšení kresby (pro maskable ikonu)

    def p(x, y):
        return (s / 2 + (x - 512) * k, s / 2 + (y - 512) * k)

    def box(x0, y0, x1, y1):
        return [*p(x0, y0), *p(x1, y1)]

    # silnice
    d.rounded_rectangle(box(140, 700, 884, 740), radius=20 * k, fill=(96, 140, 240))
    # karoserie auta
    d.rounded_rectangle(box(190, 470, 834, 650), radius=70 * k, fill=WHITE)
    d.polygon([p(320, 480), p(400, 330), p(640, 330), p(730, 480)], fill=WHITE)
    # okna
    d.polygon([p(360, 470), p(420, 365), p(505, 365), p(505, 470)], fill=BLUE)
    d.polygon([p(535, 470), p(535, 365), p(620, 365), p(690, 470)], fill=BLUE)
    # světla
    d.ellipse(box(770, 520, 815, 565), fill=YELLOW)
    # kola
    for cx in (340, 690):
        d.ellipse(box(cx - 78, 580, cx + 78, 736), fill=(15, 23, 42))
        d.ellipse(box(cx - 34, 624, cx + 34, 692), fill=(203, 213, 225))
    # slunce
    d.ellipse(box(700, 140, 840, 280), fill=YELLOW)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    draw_icon(180, 0.06).save(OUT / "apple-touch-icon.png")
    draw_icon(192, 0.06).save(OUT / "icon-192.png")
    draw_icon(512, 0.06).save(OUT / "icon-512.png")
    draw_icon(512, 0.16).save(OUT / "icon-512-maskable.png")
    print("Ikony uloženy do", OUT)


if __name__ == "__main__":
    main()
