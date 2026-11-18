# KatoSync 4.0 — Feature-Acceptance-Ledger (Trust Gate 1)

**Stand:** 04.11.2026 · **Status:** isolierter, getesteter Verifikationskern im Draft-Zweig, keine produktive Freigabe.
**Baut auf:** Smart Project Flow PR #230, Issue #229 und 4.0-Epic #224.
**Quellen:** `src/lib/featureAcceptanceLedger40.ts`, `tests/featureAcceptanceLedger40.test.ts`.

## Ziel und Vertrauensgrenze

Der vorhandene Fortschrittsbalken bleibt **gemeldeter** Roadmap-Fortschritt. Der separate
**abgenommene** Wert ist bis zur wirksamen Integration einer unabhängigen Authority
`null`. Keine Git-Commits, generischen CI-Grünanzeigen, Modellbewertungen,
lokalen Markdown-Dateien, Browserdaten oder einfachen `ownerApproved: true`-Flags
dürfen den abgenommenen Prozentwert erhöhen.

Die neue `verifyFeatureAcceptanceLedger40`-Routine liefert einen verifizierten
Snapshot **nur dann**, wenn **alle** folgenden Bedingungen erfüllt sind:

1. **Planbindung:** gleiches Projekt und gleiche positive Journal-Sequenz; ein
   SHA-256-Fingerprint des gewichteten MVP-/Side-Scopes bindet Feature-IDs,
   Gewichte, Akzeptanzkriterien und benötigte CI-Workflow-/Jobnamen.
2. **Git-Bindung:** jeder Snapshot trägt einen konkreten 40-/64-stelligen Commit-HEAD;
   identische HEADs sind verboten, jeder Nachfolger muss über einen **unabhängig
   überprüften Git-Ancestry-Nachweis** abstammen. Für aktuelle Verifizierung muss
   die jüngste Abnahme exakt auf dem gegenwärtigen HEAD liegen.
3. **Feature-Bindung:** nur explizite MVP-Aufgaben des festgelegten Scopes werden
   gewertet. Jede abgenommene Funktion braucht mindestens einen vorgeschriebenen
   CI-Job; im Snapshot müssen die geforderten Jobs exakt, eindeutig und auf
   denselben HEAD gebunden sein. Der unabhängige CI-Prüfer muss jede GitHub-
   Workflow-/Run-/Job-Kombination erfolgreich authentifizieren.
4. **Owner-Bindung:** ein unabhängig verifizierter, expliziter Owner-Entscheid
   mit gepinntem Ed25519-Public-Key muss die kanonischen Bytes aus
   `acceptanceOwnerSigningPayload40` signieren. Schlüssel-ID und Entscheidungs-ID
   sind im signierten Payload. Signatur und Owner-Entscheidung dürfen nicht aus
   einem normalen UI-Flag oder einem ungeprüften Event übernommen werden.
5. **Historie:** SHA-256-verkettete Receipts mit korrektem Vorgängerhash,
   chronologischen Zeitstempeln, jeweils eindeutigen HEADs und Owner-Entscheiden,
   sowie monoton wachsender Menge akzeptierter Funktionen. SHA-256-Verkettung
   allein **authentifiziert nicht**, sie macht nur nachträgliche Änderungen
   erkennbar, sofern die extern signierten Vertrauensanker erhalten bleiben.
6. **Fail closed:** ein ungültiger, fehlender oder veralteter Nachweis lässt
   `verifiedPercent = null` und `milestones = []`; keine Teilfreigabe
   bei einem manipulierten späteren Receipt.

Die verifizierten Snapshots werden als `AcceptedMilestone40` in die bereits
getestete konservative ETA-Funktion gespeist. Die bestehende Bedingung
`>= 3` verifizierte unabhängige Abnahmen über `>= 7` Tage wird nicht gelockert.

## Datenvertrag (v1)

- `AcceptanceScope40`: Projekt-ID, Plan-Journal-Sequenz, die expliziten
  MVP-/Side-Aufgaben, Gewichte 1–5, Akzeptanzkriterien und CI-Jobs.
- `AcceptanceSnapshot40`: `katosync.feature-acceptance/v1`, Projekt,
  Plan-Sequenz, SHA-256-Scope-Digest, Git-HEAD, UTC-Abnahmezeit, sortierte
  akzeptierte Feature-IDs, einzelne CI-Run-IDs, Owner-Entscheid und -Signatur,
  Vorgänger-Digest sowie eigener Receipt-Digest.
- `AcceptanceAuthority40` fordert drei voneinander unabhängige aktive
  Prüfungen: `verifyOwnerSignature`, `verifyCi` und `verifyDescendant`.
  Testdoubles dürfen niemals in eine Live-UI oder Tauri-IPC gelangen.
- `AcceptanceLedgerResult40` ist entweder `verified` mit abgenommener
  Prozentzahl und historisierten Milestones oder `unavailable` mit
  erklärtem Grund und ausdrücklich `null`.

## Nächste Integrationsstufe (noch offen, P0)

1. **Native Authority aufbauen.** Rust/Tauri überprüft die Owner-Ed25519-
   Signatur gegen den bereits bestätigten Owner-Public-Key (Keychain/Server),
   GitHub-Run-/Job-Ergebnisse über die authentifizierte GitHub-Integration und
   echte Git-Ancestry. Projekt-/HEAD-/Planbindung wird serverseitig geprüft.
2. **Lokale SQLite-Historie** in der vorhandenen Memory-Fabric-DB revisionssicher
   ergänzen. Append-only mit `UNIQUE(projectId,planSequence,head)` und
   `UNIQUE(ownerDecisionId)`, Hash-Vorgängern, Sperren bei Scopewechsel,
   zusätzlichem Audit-/Backup-Konzept. Keine Secrets oder Signatur-Private-Keys
   in Receipts oder Git.
3. **Ausschließlich read-only Tauri-Projektion** der backend-verifizierten
   Ergebnisse anbinden; keine vom Webview bereitgestellten Fake-Verifier
   und keine stille Automatik-Akzeptanz.
4. **E2E-Abnahme** auf zwei echten Projekten mit erlaubten Owner-Entscheiden,
   echten GitHub-CI-Jobs, Git-HEAD-Änderung, Scopewechsel, Offline/Sleep,
   Rücknahme und fehlerhaften/gestohlenen Nachweisen.
5. **Erst danach** einen tatsächlichen abgenommenen Fortschrittswert und
   realen Abschlusszeitraum im Smart-Flow-Panel darstellen und auf signierten
   Geräten testen. Solange diese Gates fehlen, zeigt das Produkt weiterhin
   ausdrücklich „noch nicht bestimmbar“ und „Prognose noch nicht belastbar“.

**Keine Live-/Release-Wirkung:** Dieser Slice ändert weder die installierten
Stage35e-Apps noch Mesh-Trust, Berechtigungen, Remote-Jobs oder produktive
Schreib-/Merge-/Deployment-Aktionen. Er besitzt noch keinen persistenten
Recorder und keine produktive Owner-/GitHub-Prüfautorität.
