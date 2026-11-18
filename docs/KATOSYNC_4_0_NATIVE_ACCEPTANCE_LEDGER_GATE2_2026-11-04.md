# KatoSync 4.0 — Trust Gate 2: native, append-only Acceptance-Staging

**04.11.2026 – QA-Draft auf PR #231 (nicht in M2/M3-Apps ausgerollt).**

## Ziel und exakte Sicherheitsgrenze

Die bisherige Smart-Flow-/TypeScript-Berechnung kann nur dann `verifiedPercent` liefern, wenn unabhängige Owner-, CI- und Git-Authentifizierung vorliegen. Diese Vertrauenskette ist **noch nicht vollständig**. Die neue native Schicht speichert daher ausschließlich **vom Owner kryptografisch signierte, noch nicht extern geprüfte Receipts**. Der SQLite-Status `pending_external_checks` ist bewusst unveränderlich und darf zu keinem Zeitpunkt eine Feature-Abnahme, ETA oder Release-Freigabe bewirken.

## Implementierter QA-Baustein

- Die Memory-Fabric-Datenbank erhält **Schema-Version 5**: `acceptance_pending_receipts` mit eindeutigen Projekt-/Plan-/HEAD-Schlüsseln und global eindeutiger Owner-Entscheidung. Migration v1–v4 → v5 ist atomar. Historische v4-Daten bleiben read-only ohne automatische Migration lesbar.
- SQLite-Schreibpfad `stage_owner_signed_acceptance` bleibt **nur intern in Rust** und ist nicht als Tauri-/Webview-/Cloud-API freigeschaltet. Eine zukünftige autorisierte Aufrufstelle muss den tatsächlichen gepinnten Owner-Public-Key von der nativen Identitäts-/Owner-Authority beziehen – **nicht aus dem Receipt**.
- Ed25519-Signaturprüfung gegen den übergebenen verifizierten öffentlichen Schlüssel, domänensepariertes kanonisches JSON, SHA-256-Receipt-Digest, Projektbindung, Plan-Sequenz, Scope-Fingerprint und exakter HEAD-Prüfung innerhalb des Receipts.
- Sortierte eindeutige Feature-IDs, begrenzte CI-Metadaten, derselbe HEAD in den CI-Meldungen, gültige Abnahmezeit, maximal 512 Receipts je Planversion und Projekt.
- Hashverkettung, chronologische Reihenfolge und monotone Feature-Sets; transaktionale `INSERT`-Operation mit SQLite-UNIQUE-Grenzen und Append-only-Triggern gegen `UPDATE`/`DELETE`.
- UI/Progress-Funktion bleibt **unverändert** bei `verifiedPercent = null`, egal wie viele signierte Pending-Receipts vorliegen. Kein echter CI-Nachweis, keine Git-Ancestry- oder eigentliche Abnahme wird vorgetäuscht.
- TypeScript und Rust nutzen nun denselben Domainseparator mit einem **echten Newline-Byte** (`KatoSync feature-acceptance v1\n`). Die Änderung wird durch einen TypeScript-Vertragstest gesichert.

## Offen vor einer belastbaren Funktion bzw. Prognose

1. Tatsächlichen Owner-Public-Key gegen berechtigtes KATOOS-Konto und Schlüsselrotation/Widerruf binden; native Prüfautorität, kein Frontend-Fake.
2. Verifizierte CI-Run-/Job-Ergebnisse mit GitHub-API für konkrete Arbeitsflüsse/HEAD und Git-Ancestry durch echte Repo-Prüfung nachweisen. Fail closed bei Offline-Status, Git-Force-Push oder fehlenden Rechten.
3. Separate, unveränderliche **Accepted-Evidence-Receipts** erst nach beiden externen Prüfungen erzeugen, von Pending getrennt. Kein `UPDATE` von Pending-Status auf Accepted.
4. Unterbrechungs-/Wiederaufnahmetests, Signatur-Key-Rotation, Owner-Revoke, SQLite-WAL-Backup-/Restore-Tests, M2/M3/Windows E2E mit realen Feature-Abnahmen.
5. Erst danach eine streng read-only Tauri-Projektion für `verifiedPercent` und `AcceptedMilestone40` etablieren. Keine automatische Agenten-, Mesh- oder Deployment-Freigabe.

**Build-Hinweis:** Der isolierte QA-Worktree enthält keine distributablen Poppler-/Typst-/STT-Ressourcen. Rust-Unit-Tests dürfen deshalb mit `TAURI_CONFIG='{"bundle":{"resources":[]}}'` ausgeführt werden. Das ist ausschließlich ein Test-Overlay, **kein gültiger signierter Release-Build**. Für produktive Veröffentlichung bleiben die Resource-, Lizenz-, Signatur- und Notarisierungs-Gates zwingend.
