# Kato product brand – authorized original

Master: branding/master/KatoAI_original_256.png (256 x 256, transparent).
SHA-256: 726360cab449bce8abfb9df12bdcbbe89efe0fe451fde5686f5e290c9c50cab3.

The exact owner-provided original is stored unchanged. KatoSync, Kato AI
and K2S may reuse this one pinned master for technically resized brand assets.

## Requirements

- The owner's transparent 256px master is unchanged and is the source of all exports.
- In-app, web, and K2S content retain an edge-to-edge transparent 1024px mark.
- Native macOS launch/Dock icon uses an opaque **pure black** square background,
  832px gold/silver foreground and no added shadows, to avoid macOS Tahoe 26
  rendering unsupported free-form transparent icons on its low-contrast gray tile.
- macOS clips the black icon to its own rounded-square shape. This is a
  platform-specific representation, not a modification to the shared brand master.
- Never modify existing Developer-ID-signed or Apple-notarized app bundles in place.
  Ship brand changes only through a new signed, verified and notarized QA release.
- Product names stay in UI labels; do not change the signed-off master pixels.
- Do not blindly overwrite separate KatoOS/K2S production repositories:
  adopt this same pinned source through their own normal QA process.

Generate the native icon set:
    python3 scripts/generate-katosync-icons.py

Verify the source SHA, transparent artwork, UI copies and native icon:
    python3 scripts/qa-kato-original-brand.py

Created by NMKato Solutions
