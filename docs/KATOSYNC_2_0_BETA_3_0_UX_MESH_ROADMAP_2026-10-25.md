# KatoSync 2.0 Beta und 3.0 UX-/Mesh-Ziel (25.10.2026)

## Aktueller Versionsstand
- 2.0.0 ist laut Paket- und Tauri-Konfiguration der Beta-Stand.
- 3.0 bezeichnet die geplante, noch nicht freigegebene Mesh- und Multi-Agenten-Generation.

## Gemeinsame Produktoberfläche
- Chat: lokales Offline-Modell und projektbezogener, kontrollierter Kontext.
- Mission Control: echte Projektstände, Status, Freigaben, Aufgaben und Provider-Readiness.
- Vision / Network OS: ehrlicher interaktiver Graph zu Agenten, Modellen, Geräten und Projekten.
- Jobs & Queue: trennscharfe Diagnosejobs, sichere Queue, Human Gates und Verlauf.
- Provider: Zugänge/Modelle konfigurieren; bestehende Branding-Assets wiederverwenden.

## Öffentliche GitHub-Tickets
- #125: Beta-Blocker; beide Read-only-Providerläufe scheitern und die UI zeigt nur eine pauschale Meldung.
- #126: UX und Navigation Chat + Mission Control + Network OS.
- #127: zunächst read-only Mesh mit autorisierten Geräten und nachprüfbaren Quittungen.
- #61: bestehendes Thema Logos in Vision anstelle von CL/CO.
- #76: Writer-/Lease-/Approval-Gate vor Autostart oder parallelen Schreiboperationen.
- #114: Auth-Issuer von KatoSync und KATOOS-Web differieren, kein stilles SSO.

## Aktuell nachgewiesener Fehler und Diagnose
Ein Anwender konnte bei registriertem KatoSync-Projekt weder Codex noch Claude im neuen Read-only-Dispatcher erfolgreich starten. Im UI erscheint eine generische Meldung, keine Job-ID. Die unmittelbare Ursache ist noch NICHT bestätigt.
Die Projekt-Registry existiert, und Git-Lesebefehle sowie kanonische Git-Wurzel sind außerhalb des App-Dispatchers erfolgreich überprüft.
Diagnose-Fix auf separatem Draft-Branch: neuer Button Vorab prüfen (ohne Agentenstart), dieselbe native Validierung für Konto, Registry und Git wie im Dispatcher. Nur feste, harmlose Fehlercodes, keine Quellpfade, Zugangsdaten oder Logs im UI.

## Abnahme-Reihenfolge
1. Mac-Test-App: Vorab prüfen für registriertes KatoSync-Projekt wählen. Status erfassen, noch keinen Agentenstart.
2. Auth-/Registry-/Git-Probleme gezielt korrigieren. Erst wenn Vorabprüfung grün, einen einzelnen Codex-Diagnosejob starten.
3. Job-ID, Zeit, Status, Git-Vorher/Nachher und Persistenz prüfen; dann erst Claude.
4. Native Windows/macOS-Paketierung, Wechsel der Konten und Mesh-Read-only-Pilot gesondert testen.
5. 2.0 Stable beziehungsweise 3.0 erst nach erfüllten Release- und Sicherheits-Gates freigeben.

## Öffentlichkeitsgrenze
Keine Secrets, Kennwörter, privaten Pfade, Tokens, Nutzerkennungen oder internen Infrastrukturdetails im öffentlichen Repository.


## Nachtrag 29.10.2026: Mesh Stage 2L/2M – isolierter Entwicklungsstand
- Die auf M2/M3 signierten QA-Apps wurden zuvor auf identischen FTS5-Stand abgeglichen; FTS5-Memory-Fabric-Tests waren positiv. Stabile Version unangetastet.
- Stage 2L: serverseitige, gerätegebundene Ed25519-Einladungs-Queue als **nicht ausgerollter** Draft #177; PostgreSQL-Trigger gegen Replay, Anfragespitzen und doppelte aktive Einladungen.
- Stage 2M: native `mesh_inbox_invite_prepare`-Funktion liest die **bestehende** Geräteidentität, prüft die Owner-Registry und signiert eine konkret an das Zielgerät gebundene, kurzlebige Einladung. Übersetzte UI-Schaltfläche im isolierten QA-Code. **Noch kein Versand**, keine Annahme, kein SAS und kein mTLS.
- Stage-2M-Prüfungen: 357 Node grün, 225 Rust grün (8 manuelle/inaktive Tests ignoriert), TypeScript/Build/Rustfmt grün. Release-Gate verweigert erwartungsgemäß ohne echte geprüfte Ressourcen.
- Nächster Pfad: signierte Inbox-Zustellung nur nach ausdrücklichem QA-Rollout, dann zielgeräte-signiertes Lesen/Annehmen/Ablehnen, beidseitige SAS- und TLS-1.3-Abnahme. Bis dahin `discovered` statt `trusted`; Remote-Writer gesperrt.
