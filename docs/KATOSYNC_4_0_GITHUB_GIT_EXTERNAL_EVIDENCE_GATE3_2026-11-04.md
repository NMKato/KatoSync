# KatoSync 4.0 – Trust Gate 3: GitHub-CI- und Git-Evidenz (QA)

**Stand 04.11.2026.** Isolierter Entwicklungszweig auf PR #232; keine Produktfreigabe und keine Installation auf den signierten M2/M3-Apps.

## Ziel

Authentifizierte GitHub-CI-Nachweise und lokale Git-Ancestry als unabhängige Beweise für ein **bereits signiertes, aber weiterhin ausstehendes** Feature-Receipt verwenden. Eine grüne allgemeine Workflow-Anzeige oder ein Commit allein bleibt ausdrücklich **keine Feature-Abnahme**.

## Prüfschritte (internes Rust-Modul)

- Nur offizielles GitHub-Repository im Format `owner/repo`, Git-Remote muss exakt auf dieses Repository zeigen. Repo-Verzeichnis muss eine echte Git-Wurzel sein.
- Exakter Git-HEAD und sauberer versionierter Arbeitsbaum. Für nachfolgende Abnahmen muss `git merge-base --is-ancestor` die Abstammung des früheren Commits bestätigen. Keine bloße SHA-Zeichenfolgenprüfung.
- GitHub CLI ausschließlich mit offiziellen `gh api -X GET repos/.../actions/runs/...`- und `.../jobs?filter=latest`-Endpunkten, festen Programmnamen, separaten Argumenten, Zeit- und Größenlimits.
- Workflow-Run-ID, Name, Repository und `head_repository`, Commit-HEAD sowie `completed/success` müssen exakt zusammenpassen.
- Benannter CI-Job muss genau einmal in der **vollständigen**, nicht abgeschnittenen Antwort vorkommen, zur selben Run-ID und zum neuesten Versuch gehören und erfolgreich abgeschlossen sein. Gescheiterte, alte, doppelte und unvollständige Antworten werden abgewiesen.
- Signaturprüfung bleibt wie in Gate 2 an den von einer späteren vertrauenswürdigen nativen Owner-Instanz gelieferten Ed25519-Public-Key gebunden. Kein selbstgelieferter Public Key aus dem Receipt.
- Das Ergebnis heißt ausdrücklich `corroborated_but_not_accepted`. Es gibt **keine** Tauri-Schreibfreigabe, keinen Accepted-Receipt-Writer, keine Änderung an `verifiedPercent=null` und keinen ETA-Start.

## Ausstehende Freigabegates

1. Native KATOOS-Owner-Identität und autorisierter, widerrufbarer Schlüsselanker: Konto, Rolle, Rotation, Berechtigungsprüfung, konkrete Eigentümerentscheidung.
2. Nachweis, dass die geprüften CI-Jobs **genau die erforderlichen Akzeptanzkriterien** und die aktuelle Roadmap-Scope-Revision abdecken, nicht nur generische Unit-Tests.
3. Signierte Pending-Receipts mit der dauerhaften SQL-Historie und einem dedizierten, append-only Accepted-Ledger verbinden; danach ausschließlich read-only Projektstatus-Projektion.
4. Live-E2E mit zwei registrierten Projekten, echten GitHub-Runs, Offline-/Tokenablauf, Git-Force-Push, Widerruf und aktueller Head-/Scope-Bindung.
5. Desktop-Release-Abnahme mit Distributionsressourcen, Developer-ID-Signatur, Notarisierung und Rollback auf macOS sowie Windows.

**Risikohinweis:** Der Prüfer verwendet keine Tests als Eigentümerbeweis und startet niemals automatisch GitHub-Workflow-, Merge-, Schreib- oder Deployment-Aktionen.


## Ergänzung: Ledger-Bindung und Manipulationsprüfung

Der Gate-3-Prüfer liest jetzt ausschließlich das jeweils jüngste lokal gespeicherte Pending-Receipt zu einer konkret angegebenen Projekt-ID, Plan-Journal-Sequenz und erwarteten Scope-Digest. Er überprüft die vollständige lokale SHA-256-Kette, die chronologische Abfolge, die Gleichheit aller projizierten SQL-Spalten mit den signierten JSON-Receipts und den monotonen Zuwachs akzeptiert gemeldeter Funktionen. Eine beschädigte gespeicherte Zeile wird auch dann erkannt, wenn jemand Datenbank-Trigger außerhalb der Anwendung umgeht.

Diese Speicherung bleibt ein **nachgeordneter Nachweis zur externen Prüfung**, nicht eine Annahmeentscheidung. Der interne Prüfaufruf verlangt weiterhin einen **aus vertrauenswürdiger nativer Quelle** bereitgestellten Owner-Public-Key, den zugehörigen Schlüssel-Identifier, den registrierten Git-Projektpfad und das bestätigte GitHub-Repository. Da die produktive Owner-Key-/Scope-Authority noch nicht angeschlossen ist, wird die Funktion nicht als Tauri-IPC aktiviert.

Die Tests verwenden echte lokale Git-Commits mit gültiger und ungültiger Ancestry sowie echte SQLite-Zeilen und eine bewusst manipulierte Zeile. Die GitHub-API-Antworten werden derzeit durch strikte Test-Fixtures geprüft; **ein Live-GitHub-CI-E2E-Lauf mit wirklicher Feature-Abnahme steht weiterhin aus**.
