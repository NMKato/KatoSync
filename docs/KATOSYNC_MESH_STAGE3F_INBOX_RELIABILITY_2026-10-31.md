# KatoSync Stage 3F – Inbox-Fail-Closed und UI-Race-Schutz

**31. Oktober 2026** · Auf [Stage 3E / Draft PR #197](https://github.com/NMKato/KatoSync/pull/197) aufbauend. Ziel: Der vorhandene geführte Geräte- und Inbox-Ablauf darf bei schnellen Klicks, verspäteten Serverantworten, erneuter Kontoanmeldung und abgelaufenen Nachrichten **keinen doppelten oder irreführenden Zustand erzeugen**.

## Korrigierte Fehlerklassen

1. **Doppelklick vor React-Re-Render:** Die bisherige reine `useState`-Busy-Kontrolle (`nativeInboxBusy`, `recipientBusy`, `directoryBusy`) verhindert parallele native Requests nicht sicher, weil direkt aufeinanderfolgende Click-Events noch denselben alten React-Zustand sehen können. Neue, sofort geschriebene `useRef`-Gates verhindern gleichzeitiges `mesh_inbox_invite_send`, `mesh_inbox_invite_prepare`, `mesh_inbox_recipient_list`, `mesh_inbox_recipient_decide` und parallele Directory-Aufrufe. Ein bereits bestätigter Versand ist bis zum bewussten neuen Gerätelisten-Refresh nicht erneut anforderbar.
2. **Veraltete Antworten nach Konto-/Statuswechsel:** Jede der drei Request-Klassen führt einen monotonen Operation-Counter. Statusänderung/erneute Anmeldung verwirft alle bisherigen Generationen und leert Geräteliste, Auswahl, Empfangsliste und Sendestatus. Eine verzögerte Antwort aus der alten Generation kann keinen inzwischen zurückgesetzten Zustand wiederherstellen; ihr `finally`-Block kann keine neue Operation unberechtigt als beendet markieren.
3. **Abgelaufene Inbox-Einträge:** Die native Rust- und Edge-Validierung bleibt maßgeblich. Im UI werden während des Transports abgelaufene Einträge aus der Anzeige gefiltert, anstatt den gesamten Inbox-Abruf als fehlerhaft zu deklarieren. Die neue reine Funktion `activeMeshInvitations` filtert abgelaufene/ungültige Zeitwerte deterministisch. `nextMeshInboxExpiryDelay` plant höchstens einen durch React-Effect bereinigten Timer für den nächstfälligen Eintrag. **Kein Hintergrund-Poll, kein automatisches Neuversenden, keine Vertrauensfreigabe.**
4. **Verantwortungskette:** Nur die schon vorhandene bewusste Schaltfläche versendet nach den nativen und serverseitigen Gates. Eine nur empfangene oder angenommene Einladung bedeutet **nicht** „verbunden“; kein Remote-Auftrag und kein persistenter Keychain-Trust werden erzeugt.

## Tatsächlich durchgeführte Tests

- **452/452 reguläre Node-Tests PASS**, einschließlich 4 neuer Stage3F-Tests für deterministische Ablaufzeit, Ref-Einmaligkeit, Operation-Generation und Konto-Reset. Vite-Produktionsbuild und TypeScript PASS.
- **Echter Headless-Chromium-Browserlauf** auf dem physischen M2 mit lokalem Vite-Server und **ausschließlich synthetisch gemocktem Tauri-Native-API**:
  - Hauptbutton `Verbinden` liest nur `mesh_account_devices_list` (kein stilles Enrollment).
  - Zwei synchron ausgelöste Klicks auf `Einladung senden (QA)` erzeugten **exakt einen** nativen `mesh_inbox_invite_send`-Aufruf, obwohl die synthetische Serverantwort um 600 ms verzögert war. Nach erfolgreichem Senden bleibt die gleiche Anfrage gesperrt.
  - Der Posteingang lieferte zwei signatursimulierte Einträge, einer lief nach 1,25 Sekunden ab. Dieser wurde ohne Polling entfernt; nur der gültige blieb annehmbar.
  - Zwei synchron ausgelöste Klicks auf `Annehmen` erzeugten **exakt einen** nativen `mesh_inbox_recipient_decide`-Aufruf bei 600-ms-Antwortverzögerung.
  - Während des gesamten Ablaufs wurde **kein** unbewiesener Status `Verbunden` angezeigt.
  - Browsertestausgabe: `MESH_STAGE3F_CHROMIUM_RACE_PASS`.
- Nach der QA wurden lokaler Testlistener und alle drei Harness-Dateien entfernt.
- Die Rust-Integrations- und mTLS-Hardwaretests der vorangegangenen Stages bleiben unverändert; zusätzliche lokale Rust-Regression in dieser Stage siehe PR-Ergebnis. Release-Lock weiterhin `RELEASE_BLOCKED: RELEASE_LOCK_MISSING`.

## Umfang und verbleibende Sperren

**Kein produktiver Cloud-Aufruf**, keine Migration oder Edge-Deployment, keine Änderung am echten Keychain, keine neue Gerätefreigabe, keine Änderung der installierten KatoSync-Apps. Die Tests verwenden lokale simulierte Antworten und die bestehenden unveränderten Backend-Sicherheitsgates.

**Weiter offen:** echte KATOOS-Kontositzungen auf beiden Macs, ausgerollte isolierte QA-Inbox mit nativer Supabase-Gateway-/JWT-Prüfung, manuell bestätigter SAS zwischen zwei echten macOS-Keychain-Identitäten, bidirektional bestätigter und widerrufbarer mTLS-Kanal sowie dauerhafter Mesh-Verbindungsstatus. Das externe M3-Volume `/Volumes/DevSSD` war am 31. Oktober zum Prüfzeitpunkt nicht gemountet; kein stiller Mount- oder Schlüsselbund-Eingriff. M2 verfügbar, allerdings lokaler Datenträger nahezu voll; daher kein neues Rust-Build-Target oder große Dependency-Installation angelegt.

**Keine automatisierte Produktivfreigabe und keine kostenpflichtigen Cloud-Ressourcen.**
