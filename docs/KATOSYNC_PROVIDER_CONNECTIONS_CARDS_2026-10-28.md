# KatoSync Verbindungen – UI Migration 28.10.2026

Ziel: Vision bleibt reine Systemkarte. Alle Verbindungen werden auf der zentralen Provider-Seite verwaltet.

## Änderungen
- Eigenständige MeshConnectionCard statt 525 Zeilen Mesh-/Auth-UI innerhalb VisionWorkspace.
- ProviderManager zeigt Codex, Claude, Local Model, GitHub und KatoSync Mesh als getrennte Cards.
- Die LLM-Routing-Priorität bleibt ausschließlich an KI-Provider gebunden; Mesh ist kein Modell.
- In Navigation und Titel heißt die Seite jetzt Verbindungen (DE), Connections (EN), Conexiones (ES), Подключения (RU).
- Mesh-Card mit dezenter Glassmorphism-Optik, responsiven Buttons und klarer Statusanzeige.
- Kontoerneuerung, Gerätesuche, signierte Einladungen, SAS-Nachweis und Widerruf bleiben in Details verborgen und sind weiterhin verfügbar; Formularfeldbreite maximal 350px.
- Keine neue automatische Kopplung: Geräteerkennung ist bis zum sicher veröffentlichten Registry-/Inbox-Dienst gesperrt. Verbinden erstellt weiterhin nur eine signierte Einladung.
- Bestehende kryptografische Schutzgrenzen sowie read-only/no-writer-Verhalten unverändert. Keine Keychain-Zugriffe oder native Rust-Änderungen durch diesen PR.

## Qualität und Release-Gates
- 283/283 Frontend-Tests bestanden, inklusive 3 neuer Komponenten-/Sicherheits-Regressionstests.
- TypeScript und Vite Production grün, git diff --check grün.
- Native Mac QA-Build und Browserprüfung sind separate Gates; main bleibt unangetastet.
- Eine echte Verbindung darf erst nach signiertem Enrollment, geräteübergreifendem Einladungseingang, verifiziertem mTLS-Transport und expliziter Nutzerfreigabe als verbunden dargestellt werden.
- Danach erst echte Laufzeit-/Qualitätsmessung und Trennen-Aktion aktivieren.
