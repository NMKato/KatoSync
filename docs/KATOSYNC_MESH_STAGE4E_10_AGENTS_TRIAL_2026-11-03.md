# KatoSync Stage 4E – 10 autonome Mesh-Agenten und 14 Tage Test

Stand: 03.11.2026. Produktentscheidung und testbarer Entwicklungsstand; kein aktiviertes Billing.

## Tarifvertrag

- KatoSync Free: 0 Euro, lokale App-Nutzung möglich, kein Cloud-Mesh, 0 Mesh-Agenten.
- KatoSync Pro: Zielpreis 9,90 Euro monatlich, maximal 10 registrierte Geräte mit je einem eigenständigen KI-Agenten. Öffentlichen Bruttopreis, Mehrwertsteuer und tatsächliche Marge vor Verkaufsstart prüfen.
- Trial: 14 Tage Mesh-Pro-Funktionen, ohne automatische kostenpflichtige Verlängerung. Eigene ChatGPT-/Claude-/API-Zugänge der Nutzer; keine inkludierten kostenpflichtigen Modellkontingente. Ein Trial pro verifiziertem KATOOS-Konto, geschützt durch serverseitige Registrierung.
- Zehn einsatzbereite Geräte ergeben zehn parallel verfügbare Agenten-Slots. Nicht erreichbar, nicht ausreichend berechtigt, ausgelastet oder ohne geeigneten Provider bedeutet nicht lauffähig. Der Anbieter garantiert nicht zehn jederzeit verfügbare externe LLM-Sessions.

## Umgesetzter Entwicklungsstand

- src/lib/meshAgentCapacityPlanner.ts ist ein reiner deterministischer Scheduler. Er erzeugt Vorschläge für 10 parallele Geräteaufträge, führt keine Aktionen aus und kopiert keine Provider-Anmeldedaten.
- Jeder Agent hat Name, Geräteidentität, eigene Fähigkeiten und einen Writer-Slot. Faires Least-Recently-Used-Routing; Aufgaben desselben Repo-/Worktree-Schlüssels werden nicht parallel geschrieben.
- Harte Gates: Serverbestätigung Pro/Trial, Trial-Frist, Session, Peer-Trust, mTLS, Remote-Job-Berechtigung, frischer Heartbeat, Provider-Fähigkeit und Aufgabenfreigabe. Laufende Leases bleiben belegt und werden nicht still neu gestartet.
- Die Rust-Gerätelisten-Korrektur in src-tauri/src/mesh_directory.rs akzeptiert das reale PostgREST-snake_case, liefert der UI weiter camelCase und behält Owner-/Fingerprint-/Replay-Validierungen bei.
- Die Entitlement-Funktion in supabase/functions/mesh-device-enrollment/device-entitlement.ts liest auch policy_expires_at. Ein abgelaufener Trial verliert seine Berechtigung für neue Registrierungen. Das ist noch nicht deployt.
- Migrationsentwurf: mesh_trial_claims hält einen nicht wiederholbaren 14-Tage-Trial pro Nutzer. Ein weiterer Entwurf härtet den bestehenden DB-Insert-Trigger bei fehlender oder abgelaufener Berechtigung ab. Keine dieser SQL-Migrationen wurde produktiv ausgeführt.
- Der bestehende produktive Enrollment-Service v4 und die beiden derzeit registrierten M2/M3-Identitäten bleiben unverändert.

## Reale Ausführung als nächstes Release-Gate

1. Stage 4D auf beiden Macs signiert/notarisiert neu installieren und echten Gerätelisten-Readback bestätigen.
2. Die zwei Macs gegenseitig per SAS, signiertem Handshake und mTLS authorisieren.
3. Einen realen, einzeln genehmigten Remote-Job auf M3 ausführen, Quittung, Audit, Cancel/Reconnect und Lease-Idempotenz prüfen.
4. Zwei genehmigte Jobs parallel auf M2 und M3 mit getrennten Worktrees ausführen. Danach einen 10-Agenten-E2E-Test über zehn reale oder gleichwertig autorisierte Knoten durchführen.
5. Auf jedem Relay-, Inbox- und Remote-Job-Endpunkt das Entitlement bei Annahme und Ausführung serverseitig erneut prüfen, auch nach Trial-Ende.
6. KatoSync-eigenen Stripe-Produkt-/Preiskatalog einrichten, Webhooks idempotent verarbeiten und Pro/Trial/Downgrade unabhängig von der KATOOS-Hauptsubscription provisionieren. Keine automatische Abbuchung nach Gratis-Test.

## Wirtschaftlichkeit und Vertragsgrenzen

9,90 Euro pro Monat ist die beschlossene Positionierung, keine bereits belegte Gewinnmarge. Laufende Kosten für Cloud-Relay, Signaling, Logs, R2, Support, Steuern und Payment-Fees müssen pro Kunde gemessen werden. Lokale Modelle rechnen auf Nutzerhardware. Externe Provider gelten mit deren eigenen Limits, Nutzungsrechten und Kosten. Keine Weitergabe von API-Keys über das Mesh; Routing über freigegebene Jobs, nicht über geteilte Kontositzungen.

Bei Trials ohne hinterlegte Zahlungsmethode unterstützt Stripe unter anderem einen Endstatus cancel oder pause. Wir wählen für den beworbenen Test keine automatische kostenpflichtige Verlängerung; die Abrechnung muss dies vor Freigabe nachvollziehbar sicherstellen.

Aktuelles Fazit: Scheduler und Trial-Guardrails vorbereitet und lokal getestet; Mesh-Job-Ausführung, Datenbankmigrationen, öffentliche Preisabrechnung und Trial-Startfunktion noch nicht freigegeben.
