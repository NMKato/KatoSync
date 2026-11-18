# KatoSync 4.0 — Trust Gate 4: Revisionsfeste native Roadmap-Bindung

**Stand:** 04.11.2026 · **Entwicklung / kein Release** · Stack: #230 → #231 → #232 → #233 → Gate 4.

## Was implementiert wird

Die Memory Fabric erstellt aus dem gespeicherten, projektspezifischen `mvpScope` einen deterministischen SHA-256-Fingerprint. Er enthält die aktuelle Plan-Journal-Sequenz, Projekt-ID, Feature-IDs, Lane, Gewichtungen, Akzeptanzkriterien sowie die exakten erforderlichen CI-Workflow-/Jobnamen. Eine unveränderte Journalnummer reicht **nicht** aus, wenn Inhalt, Gewichte oder CI-Policy geändert werden.

**Wichtig:** `mvpScope` ist weiterhin nur ein importierter, noch nicht unabhängig genehmigter Plan. Die neue Prüfung belegt Konsistenz, **keine Eigentümerabnahme**.

Die native Funktion `digest_for_progress` verwendet dieselbe kanonische JSON-Array-Struktur und UTF-16-Ordnungslogik wie `acceptanceScopeDigest40` im TypeScript-Code. Das bisherige `localeCompare` wird ersetzt, weil regionale Sortierregeln eine Signatur auf zwei Geräten ungültig machen können. Ein fester WebCrypto-SHA-256-Testvektor ist in beiden Sprachen dokumentiert und testbar:

`ff4e2eded09670c7d20ea1d61f020dd2c36b914c5de2916980c5176eefcf4f7d`

Das getrennte Receipt-Hash- und Signaturbyteformat wird zusätzlich durch einen festen TypeScript→Rust-Vektor kontrolliert. Ein vermeintlich gültiges Receipt darf nicht durch abweichende JSON-Serialisierung auf einem anderen Betriebssystem akzeptiert werden.

## Feature-Grenzen

- Nur bekannte **MVP**-Features aus der konkreten Planrevision, keine Nebenaufgaben oder zusätzlichen Features.
- Akzeptanzkriterien müssen vorhanden sein; Gewichtungen 1–5, gültiger Nenner, keine doppelten Feature-IDs oder CI-Jobdefinitionen.
- Jedes beanspruchte MVP-Feature benötigt mindestens einen im Plan definierten CI-Job.
- Die Menge aus `workflow + job` muss **exakt** der Vereinigung aller verpflichtenden Checks entsprechen. Fehlende, zusätzliche oder doppelt benannte Jobs scheitern.
- Dokumentierte Statusbehauptungen und generische CI-Grünmeldungen zählen nicht als geprüfte Features.
- Das Prüfmodul von Gate 3 lädt weiterhin nur gespeicherte Pending-Receipts; vor jeder externen GitHub-Abfrage wird der native Roadmap-Fingerprint aus der Memory Fabric berechnet und mit dem Receipt abgeglichen.
- Rückgabe ist ausschließlich `blueprint_scope_correlated_not_owner_accepted`. Weder `verifiedPercent` noch Abschlussprognosen oder Release-Rechte ändern sich.

## Verbleibende Freigabeschritte (P0)

1. **Autorisierte Owner-Identität:** KATOOS-Sitzung reicht nicht. Es fehlt eine serverseitige Projekt-Owner-/Approver-Berechtigung mit explizit hinterlegtem Public-Key, Widerruf, Rotation und Ereignis-Audit. `verified_katosync_user()` prüft nur die Ausstelleridentität, nicht dieses Recht.
2. **Live-GitHub-End-to-End:** Echte Run-/Job-Daten und der aktuelle registrierte Git-HEAD müssen nachweislich zu den gewählten Feature-Kriterien passen.
3. **Finale Accepted-Receipts:** erst nach verbindlicher Owner-Policy, revisionssicherem Scope, fehlerfreien externen Nachweisen und verbindlicher menschlicher Abnahme; getrennt von den unveränderlichen Pending-Receipts.
4. **Read-only UI-Projektion** für bestätigte Prozentwerte und konservative ETA sowie signierte M2/M3/Windows-E2E-Abnahme.

**Sicherheitsversprechen:** Keine Freigabe durch Browser-Flags, keine automatische Annahme aller importierten Roadmap-Schritte, kein unkontrolliertes GitHub-Merge und keine Änderung an produktiven Installationen.
