# Kato product brand – authorized original

Master: branding/master/KatoAI_original_256.png (256 x 256, transparent).
SHA-256: 726360cab449bce8abfb9df12bdcbbe89efe0fe451fde5686f5e290c9c50cab3.

The exact owner-provided original is stored unchanged. KatoSync, Kato AI
and K2S may reuse this one pinned master for technically resized brand assets.

## Requirements

- No dark squircle, background tile, shadow or invented lettering behind the signet.
- The 1024px icon has only 20px transparent safe margins, instead of a small inset logo.
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
