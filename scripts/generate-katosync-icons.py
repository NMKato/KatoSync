#!/usr/bin/env python3
"""Reproduzierbarer KatoSync/Kato AI-Icon-Export aus dem Original mit Transparenz.

Created by NMKato Solutions.
MARK: Kein Squircle, kein zusätzlicher Hintergrund, kein externes Bild.
Die freigegebene Originalgrafik selbst bleibt unverändert.
"""
from __future__ import annotations

import hashlib
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "branding/master/KatoAI_original_256.png"
EXPECTED_SHA = "726360cab449bce8abfb9df12bdcbbe89efe0fe451fde5686f5e290c9c50cab3"
ICONS = ROOT / "src-tauri/icons"
SIZE = 1024
SAFE_MARGIN = 20


def load_original() -> Image.Image:
    # MARK: Fail-closed. Kein stiller Ersatz durch ein anderes Logo.
    actual = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if actual != EXPECTED_SHA:
        raise ValueError("KATO_BRAND_MASTER_SHA_MISMATCH")
    original = Image.open(SOURCE).convert("RGBA")
    if original.size != (256, 256):
        raise ValueError("KATO_BRAND_MASTER_SIZE_MISMATCH")
    alpha = original.getchannel("A")
    if alpha.getextrema() != (0, 255):
        raise ValueError("KATO_BRAND_MASTER_TRANSPARENCY_REQUIRED")
    if alpha.getbbox() is None:
        raise ValueError("KATO_BRAND_MASTER_EMPTY")
    return original


def full_canvas(original: Image.Image) -> Image.Image:
    # MARK: Vergrößerung nur der tatsächlichen Signetfläche (ohne Hintergrund).
    bounds = original.getchannel("A").getbbox()
    assert bounds is not None
    cropped = original.crop(bounds)
    factor = min((SIZE - SAFE_MARGIN * 2) / cropped.width,
                 (SIZE - SAFE_MARGIN * 2) / cropped.height)
    fitted = cropped.resize(
        (round(cropped.width * factor), round(cropped.height * factor)),
        Image.Resampling.LANCZOS,
    )
    transparent = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    transparent.alpha_composite(
        fitted, ((SIZE - fitted.width) // 2, (SIZE - fitted.height) // 2)
    )
    return transparent


def native_dock_icon(original: Image.Image) -> Image.Image:
    # MARK: macOS Tahoe 26 places free-form transparent icons on an OS gray tile.
    # A fully opaque black native icon is clipped by the OS's own squircle mask.
    # Keep the original colored emblem and its transparency unchanged.
    bounds = original.getchannel("A").getbbox()
    assert bounds is not None
    artwork = original.crop(bounds)
    factor = min(832 / artwork.width, 832 / artwork.height)
    artwork = artwork.resize(
        (round(artwork.width * factor), round(artwork.height * factor)),
        Image.Resampling.LANCZOS,
    )
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    icon.alpha_composite(artwork, ((SIZE - artwork.width) // 2,
                                  (SIZE - artwork.height) // 2))
    return icon


def main() -> None:
    original = load_original()
    transparent = full_canvas(original)
    native_icon = native_dock_icon(original)
    ICONS.mkdir(parents=True, exist_ok=True)
    # In-app, web and K2S keep the original on transparent backgrounds.
    for destination in (
        ROOT / "public/katosync_logo_centered.png",
        ROOT / "public/kai-ai-icon.png",
    ):
        transparent.save(destination, optimize=True)
    # Only native launch icons use black to counter Tahoe's gray tile.
    native_icon.save(ICONS / "icon-1024-master.png", optimize=True)
    icon = native_icon
    for dimensions, filename in (
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
    ):
        icon.resize((dimensions, dimensions), Image.Resampling.LANCZOS).save(
            ICONS / filename, optimize=True
        )
    icon.save(
        ICONS / "icon.ico", format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    with tempfile.TemporaryDirectory(prefix="katosync-original-iconset-") as temp:
        iconset = Path(temp) / "KatoAI.iconset"
        iconset.mkdir()
        for dimension in (16, 32, 128, 256, 512):
            icon.resize((dimension, dimension), Image.Resampling.LANCZOS).save(
                iconset / f"icon_{dimension}x{dimension}.png"
            )
            icon.resize((dimension * 2, dimension * 2), Image.Resampling.LANCZOS).save(
                iconset / f"icon_{dimension}x{dimension}@2x.png"
            )
        subprocess.run(
            ["iconutil", "-c", "icns", "-o", str(ICONS / "icon.icns"), str(iconset)],
            check=True,
        )
    print("KATO_BLACK_NATIVE_DOCK_AND_TRANSPARENT_UI_READY", EXPECTED_SHA)


if __name__ == "__main__":
    main()
