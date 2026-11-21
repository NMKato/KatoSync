# KatoSync UX4 — Native Mesh-Zusammenführung / Beta-Readiness (21.11.2026)

Created by NMKato Solutions. **Private QA only — no general remote command or release approval.**

## Nachgewiesene Fortschritte

- UX4-KatoOS-Anmeldung, kompakte 4.0-Verbindungskarten und bisherige Stage4J-Mesh-Leseadapter wurden durch das **explizit gewählte Feature** `ux4-mesh-qa = ["ux4-auth-qa", "stage4j-qa"]` in derselben nativen macOS-App verbunden. Die bisher vorhandenen Ed25519-/Owner-/Session-/Revision-/Peer-Gates bleiben unverändert.
- Auf M3 unter macOS wurde der native Tauri/arm64-Release-Build erfolgreich erstellt: **Exit 0**, 93 MB, lokale Ad-hoc-Signatur `codesign --verify --deep --strict` PASS. Candidate11-App auf M3 bleibt als inaktives Rückfallpaket erhalten; M2 Candidate11 läuft weiterhin. Neuer UX4-Kombinationskandidat läuft ausschließlich auf dem M3 mit vorhandenem KatoOS-Login.
- **Echter lesender Geräteabruf:** Zunächst 6 verifizierte Accountgeräte, Hauptgerät `KAI Atlas Mac-0470`, kein `MESH_ACCOUNT_NOT_CONFIGURED` mehr. Die neue UX4-QA-Instanz wurde einmalig über den normalen signierten Enrollment-Client im eigenen Account registriert; sichtbar als **KAI Astra Mac-9ABB**, jetzt 7 von maximal 10 Kontogeräten. Keine privaten Schlüssel aus Candidate11 übernommen.
- **Kein Pairing-GO:** Die QA-Geräteidentität ist registriert, aber nicht mit dem M2 gepaart. Die Native-Funktion `mesh_inbox_invite_send` verweigert das Senden ohne separat aktiviertes `KATOSYNC_MESH_INBOX_SEND_QA=1` beim Build; diese QA-App wurde ohne Send/Receive/Relay-Opt-ins erstellt. Der UI-Klick hinterließ in der produktiven privaten Owner-Datenbank **null neue Einladungen** und **null Relay-Nachrichten**. Nicht als Netzwerkstörung oder erfolgreiche Verbindung deklarieren.
- Das KatoOS-Hauptgerät M2 hat im Backend zuletzt am **19.11.2026** Präsenz gemeldet, obwohl seine C11-App auf M2 aktuell läuft und lokal Netzwerkports besitzt. Es braucht eine neue authentifizierte, signierte Präsenzbestätigung. Kein Terminaljob oder ungebundene Freigabe als Workaround.
- Der angeschlossene ChatGPT-KatoSync-MCP bietet weiterhin ausschließlich einen authentifizierten synthetischen Ping; kein Gerät-, Git-, Dateizugriff oder Computer-Use verfügbar. **RDC bleibt Rückfalltool.**

## Ehrliche UI bei deaktivierter Pairing-Freigabe

- Im UX4-Verbindungsdialog wird bei einem noch nicht genehmigten Peer der Button „Verbinden“ **deaktiviert**, solange `VITE_MESH_INBOX_SEND_QA` nicht explizit auf `1` steht. Ein lokalisierter Hinweis (DE/EN/ES/RU) erklärt den privaten Sender-Gate. Das verhindert nutzlose Anfragen und falsche Betriebsanzeigen.
- Bestehende, lokal korrekt genehmigte und widerrufbare Peer-Verbindungen können weiterhin explizit gestartet/gestoppt werden. Native Autorisierungen, Owner-Reviews, Revisionsgrenzen und Revokation bleiben unverändert.
- Das reproduzierbare Build-Skript **scripts/build-ux4-mesh-qa-macos.sh** setzt den Sender-/Empfänger-Frontendstatus ausdrücklich auf AUS und bricht bei versehentlicher Aktivierung nativer Pairing-QA-Flags ab. Eine zukünftige private Send-/Receive-Pilotversion benötigt einen **eigenen, beaufsichtigten Build** und den tatsächlichen Nachweis der passenden Server- und Empfänger-Gates.

## Codequalität und Abnahme

- Read-only Device-UI in der echten M3-WebKit-App nativ inspiziert, echte 7er-Kontoliste nach signiertem Enrollment vorhanden, Status „Freigabe nötig“ am M2 korrekt.
- Gezielte Stage4J-/UX4-Auth-/Mesh-Vertragstests: **23/23 PASS** nach UI-Gate, vor dem abschließenden Quellfreeze; vollständige Node-Regression **1053/1053 PASS**, keine Fehler/Skips. TypeScript/Vite **Exit 0**, Browser 4/4 (DE/EN/RU/ES 1240/1040/720/390), npm audit **0 bekannte Befunde**.
- Native QA-Build mit `ux4-mesh-qa` **Exit 0**, ad-hoc Signatur PASS. **Die nachträgliche Gate-/UX-Korrektur muss noch separat nativ gebündelt und sichtbar abgenommen werden**; vorherigen gebauten Kandidaten nicht als diese Korrektur ausgeben.
- Kein GitHub-Actions-Run, kein PR/main-Merge, kein produktives Worker-/DB-/OAuth-Deployment. Lokaler Browser-/Native-QA-Lauf ist kein signiertes/notarisiertes Release.

## Offene Beta-Gates (strikt getrennt)

1. M2: authentifizierte aktuelle signierte Gerätepäsenz aus Candidate11 oder geprüftem eigenen C11-Update, ohne Source-/Keychain-Kopien.
2. **Erster echter Peer-Sicherheitsdialog** in einem ausdrücklich freigegebenen, getrennter QA-Build: Senderflag, Empfängerflag und Relayflag auf ihren jeweils vorgesehenen Geräten sowie Edge-Funktionsgates; signierte Einladung und beiderseitiger Vergleichscode, explizite Owner-Genehmigung. Keine automatische Zulassung.
3. Frische signierte Peer-Verbindung und Wiederaufnahme auf M2↔M3; anschließend nur ein freigegebener, **read-only**, projektgebundener Git-Statusauftrag.
4. ChatGPT-MCP-Client-Grant, TOTP/Owner-MFA, konkrete Device-/Projektfreigabe und WebSocket/Toolregistrierung. Bis zu einem echten `tool.result` und unabhängiger Gegenprobe **kein Ersatz für RDC**.
5. Developer-ID-Signierung, Notarisierung, kontrollierte macOS- und Windows-Beta mit Installer/Rollback erst nach nativen Gate-Abnahmen.

**Status:** UX4-Facelift und lesender Account-Roster GO als private Beta-Quelle; automatische Paarung, Remote-Git/CLI, Windows-/Notarisierungs-Release und vollständiges KatoSync 4.0 sind NO-GO.
