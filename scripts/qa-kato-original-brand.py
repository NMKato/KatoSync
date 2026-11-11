#!/usr/bin/env python3
"""Stage4O: canonical logo, transparency, generated PNG and ICNS consistency."""
from __future__ import annotations

import hashlib
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "branding/master/KatoAI_original_256.png"
EXPECTED_SHA = "726360cab449bce8abfb9df12bdcbbe89efe0fe451fde5686f5e290c9c50cab3"

assert hashlib.sha256(MASTER.read_bytes()).hexdigest() == EXPECTED_SHA, "MASTER_CHANGED"
assert Image.open(MASTER).size == (256, 256), "ORIGINAL_SIZE_CHANGED"

expected = Image.open(ROOT / "src-tauri/icons/icon-1024-master.png").convert("RGBA")
assert expected.size == (1024, 1024)
alpha = expected.getchannel("A")
assert alpha.getextrema() == (255, 255), "NATIVE_DOCK_ICON_MUST_BE_OPAQUE"
assert expected.getpixel((0, 0)) == (0, 0, 0, 255), "NATIVE_DOCK_MUST_BE_BLACK"
assert expected.getpixel((512, 512))[:3] != (0, 0, 0), "LOGO_NOT_VISIBLE"

# Native macOS/Windows launcher icon is black; UI retains real alpha.
ui_icons = []
for name in ("public/kai-ai-icon.png", "public/katosync_logo_centered.png"):
    candidate = Image.open(ROOT / name).convert("RGBA")
    assert candidate.getchannel("A").getextrema() == (0, 255), f"UI_ALPHA_LOST: {name}"
    assert candidate.getchannel("A").getbbox() == (20, 20, 1004, 1004), f"UI_SCALE_BAD: {name}"
    ui_icons.append(candidate)
assert ImageChops.difference(ui_icons[0], ui_icons[1]).getbbox() is None, "BRAND_UI_DRIFT"

for name, size in (
    ("32x32.png", (32, 32)),
    ("128x128.png", (128, 128)),
    ("128x128@2x.png", (256, 256)),
):
    icon = Image.open(ROOT / "src-tauri/icons" / name).convert("RGBA")
    assert icon.size == size
    assert icon.getchannel("A").getextrema() == (255, 255), name
    assert icon.getpixel((0, 0)) == (0, 0, 0, 255), name

icns = ROOT / "src-tauri/icons/icon.icns"
assert icns.read_bytes().startswith(b"icns"), "ICNS_HEADER_BAD"
assert icns.stat().st_size > 10_000, "ICNS_TOO_SMALL"
with tempfile.TemporaryDirectory(prefix="katosync-stage4o-icns-") as temp:
    iconset = Path(temp) / "check.iconset"
    subprocess.run(["iconutil", "-c", "iconset", "-o", str(iconset), str(icns)],
                   check=True, stdout=subprocess.DEVNULL)
    layer = Image.open(iconset / "icon_512x512@2x.png").convert("RGBA")
    assert ImageChops.difference(expected, layer).getbbox() is None, "ICNS_MASTER_MISMATCH"

print("KATO_ORIGINAL_MASTER_SHA256_PASS")
print("KATO_OPAQUE_BLACK_DOCK_ICON_PASS")
print("KATO_WIDGET_AND_APP_BRANDING_CONSISTENT_PASS")
print("KATO_ICNS_MASTER_MATCH_PASS")
