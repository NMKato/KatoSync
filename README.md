# KatoSync

KatoSync ist eine Tauri-v2-App für macOS, die lokale Projektstatus- und Memory-Dateien scannt, CURRENT-Dateien erzeugt und diese in eine Mistral Library hochlädt.

## Aktueller Stand

- React/TypeScript Frontend
- MVVM+Repository-Struktur
- Rust/Tauri Core für Scan, Secret-Filter, CURRENT-Dateien, Upload, Keychain und lokalen Uploadplan per LaunchAgent
- Dry-Run und echter Upload getrennt
- Mistral API-Key nur in macOS Keychain
- keine Löschlogik für Mistral Library

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
npm run build
npm run tauri build
```

Der Web-Frontend-Build wurde verifiziert. Der Tauri/Rust-Build braucht eine installierte Rust-Toolchain.

## Reports Inbox

Die geplante Erweiterung für fertige Mistral-Agentenberichte ist als Version 1.1 in `docs/ARCHITECTURE.md` beschrieben. Priorisiert wird die Mistral Workflow Runs API statt Gmail/Outlook. Die Trennung zwischen lokalem Uploadplan und Mistral Work Scheduler ist in `docs/MISTRAL_WORK_SCHEDULER.md` dokumentiert.
