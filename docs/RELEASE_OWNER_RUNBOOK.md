# KatoSync v1.0 Release Owner Runbook

Stand: 2026-06-28

## Ziel

Release-Packaging fuer den macOS Desktop Agent unblocken, ohne Secrets ins Repository zu schreiben.

## Owner-Schritte fuer heute

1. `feat/ffmpeg-sidecar` PR reviewen und mergen, nachdem Build und Security-Checks gruen sind.
2. ffmpeg/ffprobe Sidecar-Binaries fuer alle Zielarchitekturen hosten und Checksums dokumentieren.
3. Nach dem Merge `bundle.externalBin` nur auf vorhandene, versionierte Sidecar-Pfade setzen.
4. Apple Signing/Notarization lokal oder in CI ueber Env-Vars aus `docs/release-env.example.sh` konfigurieren.
5. Release-Build ausfuehren und Gatekeeper pruefen: `npm run build`, `npm run tauri build`, `spctl --assess --verbose`.

## Aktueller Repo-Zustand

- macOS Hardened Runtime ist in `src-tauri/tauri.conf.json` explizit aktiviert.
- `src-tauri/Entitlements.plist` ist als minimale Entitlements-Datei verdrahtet.
- `signingIdentity` und `providerShortName` bleiben bewusst `null`, bis der Owner die echten Apple-Werte setzt.
- ffmpeg Sidecar ist in diesem Checkout noch nicht aktiviert, weil keine Sidecar-Binaries im Repo vorhanden sind.

## Nicht ins Repo schreiben

- Apple ID, Team ID, App-spezifisches Passwort, API Key ID, Issuer ID, private Keys.
- Zertifikatsdateien, Keychain-Passwoerter, Notary-Profile oder gehostete Binary-Upload-Credentials.
