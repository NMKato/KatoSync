#!/usr/bin/env python3
"""KatoSync-Icon: 3D-Markenzentrum, sauberer macOS-Squircle, einheitliches Logo.

Created by NMKato Solutions.
Aus reproduzierbarem Original-Logo: keine externen Bilder/Marken/Schriften.
"""
from __future__ import annotations

import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/katoos_icon_logo_trans.png"
OUTPUT = ROOT / "public/katosync_logo_centered.png"
ICONS = ROOT / "src-tauri/icons"
SIZE = 1024

def trim_mark(src: Image.Image) -> Image.Image:
    # MARK: Farbige Staub-/Glow-Pixel behalten, reine Transparenz wegschneiden.
    mask = src.getchannel("A").point(lambda a: 255 if a >= 32 else 0)
    bounds = mask.getbbox()
    if not bounds:
        raise ValueError("KATOSYNC_ICON_SOURCE_EMPTY")
    left, top, right, bottom = bounds
    padding = max(34, int(max(right-left,bottom-top)*0.025))
    return src.crop((max(0,left-padding),max(0,top-padding),
                     min(src.width,right+padding),min(src.height,bottom+padding)))

def fit_mark(mark: Image.Image, extent: tuple[int,int]) -> Image.Image:
    w, h = mark.size
    factor = min(extent[0]/w, extent[1]/h)
    return mark.resize((round(w*factor),round(h*factor)),Image.Resampling.LANCZOS)

def centered_canvas(mark: Image.Image, extent: tuple[int,int]=(900,850)) -> Image.Image:
    fitted = fit_mark(mark,extent)
    canvas = Image.new("RGBA",(SIZE,SIZE),(0,0,0,0))
    # MARK: Optischer Mittelpunkt statt historischer +87px Rechtsversatz.
    canvas.alpha_composite(fitted,((SIZE-fitted.width)//2,(SIZE-fitted.height)//2))
    return canvas

def squircle() -> Image.Image:
    # MARK: Abgerundeter 3D-Körper mit ruhigem Petrol-Verlauf.
    background = Image.new("RGBA",(SIZE,SIZE),(0,0,0,0))
    pix = background.load()
    for y in range(SIZE):
        for x in range(SIZE):
            # Inneres dunkler, obere linke Ecke mit feinem kaltem Highlight.
            light = max(0.0,1.0-math.hypot((x-280)/980,(y-170)/1120))
            bottom = y/SIZE
            pix[x,y]=(round(11+18*light+4*bottom),
                      round(25+35*light+3*bottom),
                      round(28+32*light+2*bottom),255)
    mask = Image.new("L",(SIZE,SIZE),0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((23,23,SIZE-24,SIZE-24),radius=223,fill=255)
    # Subtile Glaskante innerhalb des Squircle.
    gloss = Image.new("RGBA",(SIZE,SIZE),(0,0,0,0))
    border = ImageDraw.Draw(gloss)
    border.rounded_rectangle((34,33,SIZE-35,SIZE-36),radius=215,
      outline=(113,210,197,75),width=5)
    border.arc((73,48,SIZE-76,SIZE-72),195,332,
      fill=(148,223,205,41),width=7)
    background.putalpha(mask)
    gloss.putalpha(ImageChops.multiply(gloss.getchannel("A"),mask))
    background.alpha_composite(gloss)
    return background

# Explicit import for compositing mask.
from PIL import ImageChops

def main() -> None:
    original = Image.open(SOURCE).convert("RGBA")
    raw = trim_mark(original)

    # App-interne SVG-/Bild-Nutzung bekommt ein neu zentriertes transparentes Logo.
    centered_canvas(raw,(924,865)).save(OUTPUT,optimize=True)
    icon = squircle()
    artwork = centered_canvas(raw,(795,720))
    # Sanfter räumlicher Schlagschatten direkt unter dem 3D-Signet.
    shadow = Image.new("RGBA",(SIZE,SIZE),(0,0,0,0))
    shadow.putalpha(artwork.getchannel("A").filter(ImageFilter.GaussianBlur(26)).point(lambda a:round(a*0.42)))
    shifted=Image.new("RGBA",(SIZE,SIZE),(0,0,0,0))
    shifted.alpha_composite(shadow,(0,16))
    icon.alpha_composite(shifted)
    icon.alpha_composite(artwork)
    # MARK: Kein zusätzlicher Text; K muss auch im Dock lesbar bleiben.
    image_dirs = ICONS
    for dimensions, filename in ((32,"32x32.png"),(128,"128x128.png"),(256,"128x128@2x.png")):
        icon.resize((dimensions,dimensions),Image.Resampling.LANCZOS).save(image_dirs/filename,optimize=True)
    icon.save(ICONS/"icon-1024-master.png",optimize=True)
    icon.save(ICONS/"icon.ico",format="ICO",sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
    with tempfile.TemporaryDirectory(prefix="katosync-iconset-") as temp:
        iconset = Path(temp)/"KatoSync.iconset"
        iconset.mkdir()
        for dimension in (16,32,128,256,512):
            icon.resize((dimension,dimension),Image.Resampling.LANCZOS).save(iconset/f"icon_{dimension}x{dimension}.png")
            icon.resize((dimension*2,dimension*2),Image.Resampling.LANCZOS).save(iconset/f"icon_{dimension}x{dimension}@2x.png")
        subprocess.run(["iconutil","-c","icns","-o",str(ICONS/"icon.icns"),str(iconset)],check=True)
    print("CENTERED_KATOSYNC_ICON_READY",OUTPUT,ICONS/"icon.icns")

if __name__ == "__main__":
    main()
