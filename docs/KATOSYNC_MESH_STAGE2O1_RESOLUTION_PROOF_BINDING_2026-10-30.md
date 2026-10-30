# KatoSync Mesh – Stage 2O.1: Proof-Binding vor SAS/mTLS

Stand: 30. Oktober 2026. Sicherheits-Hardening als **neuer gestapelter Draft** auf Stage 2O / PR #180. **Weder produktiv noch in installierten QA-Apps aktiviert.**

## Befund

Im bisherigen Ablauf wurde die Ed25519-Signatur des Empfängers an der Edge-Grenze geprüft und eine kurzlebige Nonce in `mesh_inbox_proofs` einmalig gespeichert. Das separate Datenbank-`PATCH` der Einladung referenzierte diesen Nachweis jedoch **nicht direkt**. Ein Fehler oder ein kompromittierter privilegierter Dienst könnte deshalb eine Entscheidung ohne konkrete gespeicherte Gerätebestätigung auslösen. Außerdem prüfte die bisherige Triggerlogik zwar den Widerrufsstatus der Quellidentität, aber nicht, ob deren aktueller öffentlicher Schlüssel noch dem ursprünglich signierten Angebot entspricht.

## Implementierter Patch

- Additive Migration `20261030074910_mesh_resolution_proof_binding.sql` erzeugt ein optionales FK-Feld `resolution_proof_id` und dessen UNIQUE-Constraint auf der Einladung.
- `accepted` und `rejected` benötigen beim neuen Schreiben jetzt eine Proof-ID. Die Security-Invoker-Triggerfunktion prüft gegen die **echte** Proof-Tabelle im selben Datenbank-Update: Eigentümer, Zielgeräte-ID, Einladungs-ID, `accept`/`reject`-Aktion, maximal 90 Sekunden Alter und noch nicht abgelaufen.
- Der Trigger vergleicht den aktuell registrierten Ed25519-Senderschlüssel mit `signed_offer.publicKey`, verhindert also Annahmen nach einem Quellschlüsselwechsel. Zusätzlich gelten weiterhin die Source-/Target-Revocation-Prüfungen aus Stage 2O.
- Der Edge-Dienst verlangt nach dem Nonce-Eintrag die **genau passende PostgREST-Quittung** einschließlich serverseitig generierter Proof-ID. Diese wird ausschließlich intern im atomar gefilterten PATCH als `resolution_proof_id` mitgesendet. Keine vom Frontend vorgegebene Proof-ID, kein Service-Role-Schlüssel im Client.
- Neu ist auch eine erneute Ablaufzeitprüfung nach der DB-Speicherung und unmittelbar vor der Entscheidung.
- Kein neuer Trust-State, keine remote Jobs, kein SAS-Skip. `paired=false`, `transportReady=false` und `remoteJobsEnabled=false` bleiben unverändert.

## Rollout-Sicherheitsgrenzen

Die neue CHECK-Constraint wird **NOT VALID** angelegt, damit bereits existierende historische Entscheidungen nicht blind umgeschrieben werden. Neue Inserts/Updates werden trotzdem sofort geprüft. Für den späteren kontrollierten Rollout müssen vor der abschließenden `VALIDATE CONSTRAINT` eventuell vorhandene alte entschiedene Einladungen geprüft und archiviert werden; **kein** automatisches Backfill oder Löschen von Produktivdaten. Auch die geplante langfristige Retention der Proof-Tabelle ist vor Produktion festzulegen.

Der gestapelte Rollout benötigt weiterhin erst Stage 2L, dann Stage 2O, danach 2O.1. Die Live-Mesh-Tabelle wurde heute nur gelesen: **0 Einladungen, die Stage-2L-/2O-Migrationen noch nicht angewendet**. Es fand keinerlei Deployment oder echte M2→M3-Einladung statt.

## Prüfungen

- 380/380 Node-Tests bestanden; neue reale Ed25519-API-Negativtests verweigern unpassende Proof-Quittungen.
- Isoliertes PostgreSQL-17-Testcluster: echte gestapelte Migrationen; Abwehr gegen Update ohne Proof, falsche Aktion, fremde Einladungs-ID, veränderten Senderschlüssel und doppelte Entscheidung; positive einmalige Entscheidung mit korrektem Proof. `MESH_INBOX_RESOLUTION_PROOF_BINDING_PASS`.
- TypeScript, Vite-Build und weitere native Rust-Regression getrennt prüfen.
- Release-Prüfung muss ohne vollständige echte Bundle-Ressourcen absichtlich blockieren.

## Nächste Freigabegates

1. SQL-Sicherheitsaudit inklusive Service-Role-Berechtigungen, migrierte Bestandsdaten, FK-/Trigger-Reihenfolge und Proof-Retention.
2. Gezielter, isolierter QA-Rollout der gestapelten Migrationen/Edge-Funktionen; echte M2/M3-Signatur- und Inbox-E2E-Tests.
3. Stage 2P: **beidseitiger menschlicher SAS-Vergleich, Schlüssel-Pinning, authentifiziertes TLS 1.3/mTLS**, Widerruf und Wiederverbindung.
4. Erst nach Hardwarebeleg Status `Verbunden`; Remote-Reader gesondert freigeben, Writer weiterhin sperren.
