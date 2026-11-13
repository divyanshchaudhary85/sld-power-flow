"""Generate permission-cleared drawing-format samples, never extraction responses.

Requires reportlab and Pillow (available in the Codex document runtime).
Outputs are committed; this optional authoring script is not a runtime dependency.
"""
from pathlib import Path
import json
import hashlib
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "drawings"
OUT.mkdir(parents=True, exist_ok=True)
WIDTH, HEIGHT, SCALE = 1000, 700, 3


def scene(page):
    commands = []
    def line(points, width=2): commands.append(("line", points, width))
    def rect(box, width=2): commands.append(("rect", box, width))
    def circle(box, width=2): commands.append(("circle", box, width))
    def text(x, y, value, size=16): commands.append(("text", (x, y, value), size))
    text(55, 42, "SYNTHETIC SINGLE-LINE DRAWING", 25)
    text(55, 73, "File-ingestion practice only. All equipment and values are fictional.", 14)
    circle((104, 99, 156, 151), 3)
    text(123, 132, "~", 22)
    text(185, 117, "GRID 01", 18)
    text(185, 143, "11 kV", 16)
    line([(130, 151), (130, 205)], 3)
    line([(80, 205), (450, 205)], 7)
    text(490, 211, "BUS A   11 kV", 18)
    line([(280, 205), (280, 245)], 3)
    rect((265, 245, 295, 275), 3)
    line([(280, 245), (280, 275)], 3)
    text(330, 267, "CB1   CLOSED", 17)
    line([(280, 275), (280, 317)], 3)
    circle((258, 317, 302, 361), 3)
    circle((258, 343, 302, 387), 3)
    text(335, 341, "T1", 18)
    text(335, 368, "11 / 0.4 kV    630 kVA", 17)
    line([(280, 387), (280, 430)], 3)
    line([(110, 430), (635, 430)], 7)
    text(675, 436, "BUS B", 18)
    text(675, 462, "0.4 kV", 16)
    line([(480, 430), (480, 490)], 3)
    if page == 1:
        line([(462, 490), (498, 490), (480, 526), (462, 490)], 3)
        text(535, 505, "LOAD L1", 18)
        text(535, 532, "80 kW   PF 0.90 lagging", 16)
    else:
        circle((455, 490, 505, 540), 3)
        text(470, 523, "M", 22)
        text(535, 505, "MOTOR M1", 18)
        text(535, 532, "45 kW   PF 0.88 lagging", 16)
    rect((55, 577, 435, 662), 1)
    text(70, 600, "LEGEND", 15)
    text(70, 625, "Heavy line: busbar    Square: circuit breaker", 12)
    text(70, 649, "Paired circles: two-winding transformer", 12)
    rect((475, 577, 945, 662), 1)
    text(490, 600, f"DRAWING NO: SYNTHETIC-{page:02d}    REVISION: A", 14)
    text(490, 625, "Missing impedances and operating inputs are intentional.", 12)
    text(490, 649, "Separate teaching sheets: do not connect pages implicitly.", 12)
    text(55, 688, f"Own synthetic artwork - safe to share - sheet {page} of 2", 11)
    return commands


def pillow_font(size):
    for candidate in ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(candidate).exists(): return ImageFont.truetype(candidate, round(size * SCALE))
    return ImageFont.load_default(size=round(size * SCALE))


def raster(commands):
    image = Image.new("RGB", (WIDTH * SCALE, HEIGHT * SCALE), "white")
    draw = ImageDraw.Draw(image)
    for kind, values, weight in commands:
        if kind == "text":
            x, y, label = values
            draw.text((x * SCALE, y * SCALE), label, font=pillow_font(weight), fill="#16202c", anchor="ls")
        elif kind == "line": draw.line([(x * SCALE, y * SCALE) for x, y in values], fill="#16202c", width=weight * SCALE, joint="curve")
        elif kind == "rect": draw.rectangle(tuple(v * SCALE for v in values), outline="#16202c", width=weight * SCALE)
        else: draw.ellipse(tuple(v * SCALE for v in values), outline="#16202c", width=weight * SCALE)
    return image


def pdf_page(pdf, commands):
    scale = .72  # 10 x 7 inch sheets; application renders these at 300 DPI.
    pdf.setStrokeColorRGB(.086, .125, .173)
    pdf.setFillColorRGB(.086, .125, .173)
    for kind, values, weight in commands:
        if kind == "text":
            x, y, label = values
            pdf.setFont("Helvetica", weight * scale)
            pdf.drawString(x * scale, (HEIGHT - y) * scale, label)
        elif kind == "line":
            pdf.setLineWidth(weight * scale)
            path = pdf.beginPath()
            path.moveTo(values[0][0] * scale, (HEIGHT - values[0][1]) * scale)
            for x, y in values[1:]: path.lineTo(x * scale, (HEIGHT - y) * scale)
            pdf.drawPath(path)
        else:
            x1, y1, x2, y2 = values
            pdf.setLineWidth(weight * scale)
            if kind == "rect": pdf.rect(x1 * scale, (HEIGHT - y2) * scale, (x2 - x1) * scale, (y2 - y1) * scale)
            else: pdf.ellipse(x1 * scale, (HEIGHT - y2) * scale, x2 * scale, (HEIGHT - y1) * scale)
    pdf.showPage()


pages = [scene(1), scene(2)]
pdf = canvas.Canvas(str(OUT / "synthetic-training.pdf"), pagesize=(720, 504), invariant=1)
pdf.setTitle("Synthetic single-line drawing - file ingestion practice")
pdf.setAuthor("SLD Power Flow sample generator")
for commands in pages: pdf_page(pdf, commands)
pdf.save()
images = [raster(commands) for commands in pages]
images[0].save(OUT / "synthetic-training.png", dpi=(300, 300), optimize=True)
images[0].save(OUT / "synthetic-training.tiff", save_all=True, append_images=images[1:], compression="tiff_lzw", dpi=(300, 300))
records = []
for suffix in ["pdf", "png", "tiff"]:
    path = OUT / f"synthetic-training.{suffix}"
    records.append({"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size,
                    "pages": 1 if suffix == "png" else 2, "pixels_per_page_at_300_dpi": [3000, 2100],
                    "content": "Own synthetic teaching drawing; not a solved case and not a vision response."})
(OUT / "manifest.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf8")
print(json.dumps(records, indent=2))
