# KatoSync

KatoSync ist eine Tauri-v2-Desktop-App für macOS. Aus dem reinen „Project Memory Uploader" (Scan lokaler Projektstände → CURRENT-Dateien → Upload in eine Mistral Library) ist mit **2.0** ein lokaler **Agent Action Hub mit Human-in-the-Loop** geworden: Mistral-Ergebnisse werden gelesen, priorisiert und – nach Freigabe – lokal von der Codex-CLI umgesetzt. Nichts läuft ohne deine Bestätigung.

## Funktionen (2.0)

- **Dashboard-Cockpit** – Live-Status (was läuft gerade: Codex/Queue/Sync), nächster geplanter Lauf, Arbeitsstand (Offen/Ausgeführt/Erledigt …) als Donut/KPI, Codex-Live-Feed, letzter Lauf, neue Briefings und Tagesverlauf. Alles aus echten Daten, mit ehrlichem Leerzustand statt Platzhaltern.
- **Briefings** – Mistral-Berichte als gerendertes Markdown inkl. animierter Komponenten (KPI/Ampel/Donut/Balken/Timeline/Callout über den `katosync:*`-Format-Contract). Annehmen / an Codex übergeben / ablehnen.
- **Action Queue & Projekt-Board** – Agent-Pläne lokal prüfen und freigeben; freigegebene Aufgaben pro Projekt einplanen, sortieren und sequenziell an Codex übergeben (Tageslimit, Merge-Rückkanal).
- **Codex-Bridge** – freigegebene Aufgaben laufen lokal über die Codex-CLI auf einem eigenen Branch (von main abgezweigt, Auto-Commit, optional Push + PR). Kein Auto-Merge in main.
- **Mehrsprachig (De/En/Es/Ru)** – Sprachschalter in der Seitenleiste, erkennt beim Start die Systemsprache und merkt sich die Wahl.
- **Geführtes Onboarding** (Splash → Login → Nutzungsbedingungen → 5-Schritt-Spotlight-Tour), **Präsentationsmodus** (maskiert Token/IDs/E-Mail für Screenshots/Streams), Light/Dark-Theme.

## Architektur

- React/TypeScript-Frontend in **MVVM + Repository** (`src/App.tsx` ↔ `src/viewmodels/useKatoSyncViewModel.ts` ↔ `src/repositories/katoSyncRepository.ts`).
- Rust/Tauri-Core (`src-tauri/src/lib.rs`) für Scan, Secret-Filter, CURRENT-Dateien, Upload, macOS-Keychain, Codex-Lauf und lokalen Uploadplan per LaunchAgent.
- Design-Token-Schicht + i18n in `src/styles.css` bzw. `src/i18n/`.
- Rückkanal über den KatoOS-MCP-Server (`https://mcp.katoos.de`); Mistral API-Key und Connector-Token liegen ausschließlich in der macOS-Keychain.

## Entwicklung

```bash
npm install --cache ./.npm-cache
npm run dev
```

Für den Desktop-Build wird Rust benötigt:

```bash
rustup default stable
npm run tauri dev
```

## Build

```bash
npm run build        # tsc + Vite (Frontend)
npm run tauri build  # Desktop-Bundle (braucht Rust-Toolchain)
```

## Release (signiert + notarisiert)

Fertige, signierte und von Apple notarisierte Builds liegen als **GitHub-Releases** (`https://github.com/NMKato/KatoSync/releases`) – das Team lädt dort die `.app` ohne Gatekeeper-Warnung.

Owner-Checkliste für Signing/Notarization: `docs/RELEASE_OWNER_RUNBOOK.md`, secret-freie Env-Var-Platzhalter: `docs/release-env.example.sh`. Hinweis: Auf einem exFAT-Volume scheitert Tauris eigener Signier-Schritt an `xattr`; signiert/notarisiert wird dann manuell auf einer APFS-Kopie (siehe Runbook).

## Sicherheit

- Kein Auto-Merge in main, keine automatischen Zahlungen/E-Mails/Behörden- oder Finanzabgaben.
- Kein Service-Role-Key im Client; nur der öffentliche Anon-Key.
- Kritische Aufgaben werden nicht automatisch ausgeführt; Codex läuft sandboxed auf eigenem Branch.
- Keine Löschlogik für die Mistral Library.
