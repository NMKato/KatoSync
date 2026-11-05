# KatoSync 4.0 – Gate 8: Append-only Verified Acceptance Ledger

**Datum:** 05.11.2026 · Draft, QA-only, kein Beta-Release · aufgebaut auf Gate 7 / PR #238.

## Fertig implementiert

Die lokale KatoSync **Memory Fabric** besitzt jetzt zwei strikt getrennte Beweisprotokolle:

1. `acceptance_pending_receipts` — existierender unveränderlicher Speicher für Owner-signierte, **noch nicht** nachgewiesene Feature-Behauptungen. Ein Pending-Receipt zählt niemals als abgeschlossene Aufgabe.
2. `acceptance_verified_receipts` — neues **append-only, SQLite STRICT**-Ledger. Jede bestätigte QA-Abnahme bezieht sich mittels eines **fremdschlüsselgesicherten** `pending_receipt_hash` auf einen konkreten vorhandenen Pending-Nachweis. Exakte Projekt-ID, Plan-Journal-Sequenz, Scope-SHA-256, Git-HEAD, prüfender Issuer-Fingerprint, Owner-Key-ID und Zahl verifizierter CI-Jobs werden als unveränderliche Nachweisfelder gespeichert.

Neue SQL-Datenbankversion **6**. Neuanlagen v0 und bestehende Migrationen v1–v5 werden berücksichtigt; der schreibende Migrationslauf arbeitet transaktional. Read-only-Inspektion älterer Datenbanken einschließlich v5 bleibt möglich. Es wurden keine bestehenden Projekt- oder Pending-Receipts verändert. Ein Release auf produktiven M2/M3 erfordert vor der Migration ein Backup: Ältere KatoSync-Versionen können Version 6 nach dem Upgrade gegebenenfalls nicht mehr öffnen.

### Verifizierungs- und Persistenzgrenze

Eine neue **interne, nicht über Tauri/WebView/LLM erreichbare** QA-Funktion `accept_latest_pending_via_qa_issuer` führt vor der Promotion folgende echten Prüfungen aus:

1. KATOOS-SSO-Konto von der kanonischen Supabase-Identitätsquelle frisch geprüft.
2. Aktuelles, vom Backend mit dem gepinnten Ed25519-Issuer signiertes, projektspezifisches Owner-Grant abgefragt und vollständig geprüft.
3. Passendes, kryptografisch Owner-signiertes Feature-Acceptance-Receipt aus der **lokalen unveränderlichen Pending-Historie** gelesen, nicht aus einem Browserparameter übernommen.
4. Exakte GitHub-Repository-ID, Git-HEAD und Ancestry sowie die in der Blueprint-Roadmap **namentlich erforderlichen** vollständigen GitHub-CI-Runs und -Jobs erfolgreich verifiziert.
5. Gleiche aktuelle Kontoidentität und ein **zweites frisch signiertes Owner-Grant** nach dem externen Lauf geprüft (Rolle, Konto, Projekt, Key, Revision und Widerrufsstatus müssen identisch geblieben sein).
6. Git-HEAD zum Abschluss nochmals lokal geprüft; nur bei unverändertem Head entsteht ein **QA-internes** persistiertes Verified-Receipt.
7. Die Speicherung ist **atomar** (SQLite `IMMEDIATE`-Transaktion), dedupliziert Receipt-Hashes und Git-Heads, verbietet das Überspringen vorheriger Accepted-Chain-Links, Rückschritte in Feature-IDs, kleinere Prozentstände und unterschiedliche Scope-Digests.
8. Die **Gewichtung** wird allein aus dem gegen das Pending-Receipt geprüften aktuellen Blueprint-MVP-Scope berechnet. Side-Tasks sind ausgeschlossen, doppelte oder unbekannte Features und fehlende erforderliche CI-Jobs scheitern. Prozentwert wird ganzzahlig berechnet und von SQLite durch einen CHECK nochmals abgesichert. Ein tatsächlich akzeptiertes Feature mit weniger als 1 Prozent Gewicht kann korrekt als 0 Prozent gerundet werden, ohne dass die Annahme verworfen wird.

Die Datenbank schützt alle Accepted-Einträge mit `BEFORE UPDATE` und `BEFORE DELETE`-Triggern. Jede Speicherung verlangt ein zugehöriges Pending-Receipt und referenziert dieses per Foreign Key. Bestehende Tabellen wurden nicht gelöscht.

### Datenschutz / Beta-Sperren

- **Keine neue Tauri-IPC**, kein öffentliches manuelles `accept` oder `setVerifiedPercent`.
- Die Runtime benötigt beim Akzeptieren den expliziten Rust-Feature-Flag `katoos-auth-qa`. Die Standard-Build-Konfiguration lässt die interne Promotion nicht zu.
- Die produktive Funktion `project_mvp_progress` und die React-/TypeScript-Oberfläche bleiben unverändert. Selbst ein lokaler SQL-Insert in die neue Tabelle wird **nicht** als nutzerseitig verifizierter Projektfortschritt angezeigt. `verifiedPercent` bleibt derzeit **null**; Prognosen bleiben gesperrt.
- Ein späteres Release darf erst nach einem erneuten Online-Check der Owner-Rollen und CI-Evidenz beim **Lesen** aus dem Ledger verifizierte Werte anzeigen; ein lokaler DB-Eintrag allein genügt nicht.
- Der neue lokale QA-Ledger-Schreiber wurde **noch nicht** an den produktiven UI-Leseweg gekoppelt. Ein authentifizierter echter Owner-/Reviewer-/GitHub-End-to-End-Lauf mit einem positiven Akzeptanz-Receipt ist weiterhin ausstehend.
- Die Datenbank ist lokal nur best-effort privat (Mode `0600`); Trigger/Hash-Chain sind Schutz gegen versehentliche Mutation und einfache Manipulation, kein Schutz gegen einen Rechner-Administrator mit SQL-Zugriff. Für eine endgültige revisionssichere Akte werden externe signierte Nachweise und sichere Backups benötigt.

### Test-/Migrationsnachweis

- **295 von 295 Rust-Library-Tests erfolgreich** (einschließlich des nachträglichen Gewichtungs-Grenzfalltests), acht planmäßig ignoriert; darunter neue Version-5-zu-6-Migration, atomare Schema-Nachrüstung ohne Verlust vorhandener Projekte, Fremdschlüssel, Append-only-Trigger und fehlende Offline-Promotion.
- Bestehende Scope- und CI-Testketten einschließlich konkreter Run-/Job-Bindung weiterhin grün.
- **720/720 Node-Tests bestanden** mit begrenzter Parallelität. Neues Node-Sicherheits-Contract-Testmodul `tests/nativeAcceptedLedgerGate8.test.ts` prüft Migration, SQL-Constraints und die Abwesenheit einer Freigabe in der Standard-UI.
- React-/TypeScript- und Vite-Build erfolgreich (1.909 Module), bisherige Chunk-Size-Warnung ohne Abbruch; keine falsche Prozentprojektion.

## Weiterhin erforderlich vor KatoSync-4.0-Beta

1. **Echte, autorisierte Owner- und Reviewer-Registrierung** im KATOOS-Backend. Es gibt nach aktueller Live-Inspektion weiterhin **0** freigegebene Projekte, Owner-Grants und Reviewerentscheidungen. Ohne diese Voraussetzung kann der neue QA-Promotionspfad nicht positiv durchlaufen werden.
2. End-to-End-Akzeptanz mit echten KATOOS-SSO-Sitzungen, signierten Owner-Receipts, vollständigen GitHub-CI-Job-Nachweisen, Rollen-Sperre und Key-Rotation. Ein `service_role`-Datenbankeintrag allein ist noch keine unabhängig signierte menschliche Reviewer-Attestation.
3. Separat abgesicherte, beim Lesen erneut validierte Projektion auf die Dashboard-Prozentwerte und ein Forecast aus **mindestens drei unabhängigen historischen Accepted-Meilensteinen**. Keine Schätzung aus Commits, Storypoints oder Pending-Behauptungen.
4. Merge/CI aller gestapelten Draft-PRs, signierter/notarisierter Beta-Build und ein echter Mesh-Geräte-E2E-Abnahmelauf auf M2/M3. Speicherplatz-Ziel für größere Build-Pakete: mindestens 80 GiB frei, zuletzt etwa 45–46 GiB.

**Freigabeentscheid:** Interne Ledger-Persistenz und migrationssichere Datenhaltung sind vorbereitet, aber die KatoSync-4.0-Beta bleibt **nicht freigegeben**.
