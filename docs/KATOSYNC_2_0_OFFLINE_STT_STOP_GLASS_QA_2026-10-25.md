# KatoSync 2.0 Beta – Offline-Diktat mit Stop und Calm-Glass-Chat (25.10.2026)

## Gemeldeter Beta-Fehler
Der Nutzer hat zweimal ein lokales Diktat gestartet. In der bisherigen Version war kein roter Aufnahmeindikator, kein Stopp-Button und nur eine pauschale Fehlermeldung vorhanden. Technisch war das bisher ein 12-Sekunden-Swift-One-Shot ohne Stop-Kanal. Der separat ausgeführte, nur ad-hoc signierte Mach-O-Helfer hatte kein eigenes App-Info.plist; das birgt bei macOS TCC Speech-/Mikrofonberechtigungen ein Risiko. Die konkrete native Fehlermeldung aus dem ursprünglichen Liveversuch wurde nicht geloggt, deshalb keine rückwirkende Behauptung über die alleinige Ursache.

## P0-Implementierung
- Sprach-Helfer ist ein eigenes macOS-App-Bundle mit eindeutiger Bundle-ID, CFBundleExecutable, NSMicrophoneUsageDescription und NSSpeechRecognitionUsageDescription. Der Build signiert den Helfer für die isolierte QA ad hoc; Tauri packt ihn als Ressource.
- Nur lokale Speech Recognition; kein Cloud-Fallback, keine Audio-Datei, kein Auto-Versand der Nachricht.
- Protokoll über lokale Pipes: permission → recording → processing → complete/error. Frontend zeigt konkrete sichere Fehlercodes (Mikrofon/Speech verweigert, Aufnahme-Engine, Sprache nicht erkannt, Timeout, Helfer fehlt oder schlägt fehl).
- Manueller STOP über stdin beendet die Tonaufnahme und finalisiert die lokale Transkription. Automatisches Ende nach höchstens zwölf Sekunden. Rust verwaltet eine aktive UUID-Sitzung und lässt keine fremden Sitzungen stoppen; Zeitlimit inklusive Berechtigungsdialog.
- UI zeigt roten Stop-Button, Aufnahmeindikator und Timer, danach lokalen Verarbeitungsstatus und nur Texteingabe. Separater Preflight ohne Popup und Einstellungs-Button.
- Chat im Calm-Glass-Stil mit weichen Flächen, dezentem Blur und verbesserten Abständen. Projektlogik und Sicherheitsgates bleiben unverändert.

## Tests, Grenzen und nächste Abnahme
- Kompilierter Helfer mit eigener signierter Info.plist. Read-only-Preflight lieferte needs_permission ohne Aufnahme; das ist noch KEIN erfolgreicher Diktiertest.
- 208 Frontend-Regressionsprüfungen, 167 Rust-Library-Tests (7 ignoriert), TypeScript und Vite bestanden. Nativen App-Build gesondert kontrollieren.
- Nur in der separaten QA-App: Mikrofon prüfen → Deutsch diktieren → eventuelle macOS-Systemdialoge freigeben → sprechen, wenn der rote Aufnahmezustand erscheint → Aufnahme stoppen → Text im Eingabefeld prüfen. Kein automatischer Versand.
- Bei Fehler nur Code/Status prüfen. Nicht unkontrolliert wiederholt klicken oder TCC-Datenbanken löschen.
- macOS-QA bleibt ad-hoc signiert; Stable braucht Developer ID/Notarisierung und Update-TCC-Tests. Windows erfordert eigene Offline-Engine.

## Tracking
Issue #133: On-Device-STT. Issue #126: Chat UX. Issue #129: Packaging. Issue #76: Agenten-Sicherheit. Öffentliche Dokumentation enthält keine Secrets.
