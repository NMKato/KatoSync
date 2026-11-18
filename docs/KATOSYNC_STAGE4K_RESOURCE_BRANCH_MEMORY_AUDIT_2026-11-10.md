# KatoSync Stage4K – Ressourcen-, Branch- und Shared-Memory-Abnahme

Stand: 10. November 2026 (Europe/Berlin). Nur isolierter Quellcode-/Hardware-QA-Zweig. Keine Produktionsfreigabe, keine automatischen Schreib- oder Merge-Aufträge.

## Vereinbartes Ziel

- Jede Ausführungsquelle – lokaler KatoSync-Agent, Codex/OpenAI, Claude/Anthropic, weitere API-Provider, Remote Orchestrator – besitzt einen eigenen benannten Git-Branch/Worktree pro Projekt, Provider, Agent und Job.
- Gemeinsame, aktuelle Projektwahrheit umfasst PROJECT_STATUS_FLOW.md, freigegebene Memory-Dateien, Kontext-Skeleton, Feature-Ziel, Roadmap, HEAD/Branch, Arbeit/Owner/Lease, Tests, Blocker, Evidenz, nächste sichere Aktion und Agenten-Notizen.
- Projektbezogene SQLite/FTS5 Memory Fabric ist die kanonische lokale Wahrheit. Markdown/Obsidian sind menschenlesbare, zu generierende und zu verifizierende Ansichten, kein unmittelbarer Schreibkanal für KI-Befehle.
- Cross-Project-Index nur für freigegebene Projekte; niemals unkontrolliertes Lesen fremder Projektinhalte, automatische Genehmigung oder direktes Mergen auf main.

## Was jetzt wirklich funktioniert

- M2: notarisiertes Stage4J ModelGuardQA ist die einzige laufende KatoSync-GUI, PID 71328. M3: ältere SingletonFixedQA, PID 39937; neue ModelGuard-App wartet auf Besitzerfreigabe.
- M2 besitzt Gemma 4 E4B Q4_0 (4.590.807.392 Bytes), Vision-Projektor (559.874.816 Bytes), Paket-Ledger und geprüfte llama.cpp b11272 im eigenen Stage4J-App-Datenverzeichnis. Kein KatoSync-Modell auf Port 17842 geladen.
- KAI Desktop betreibt einen unabhängigen llama-server auf 127.0.0.1:61814 (PID 74002). Diesen weder beenden noch als KatoSync-Bestand betrachten.
- Beide Macs haben 16 GiB Unified Memory. M2-Speicherdruckindikator aktuell 33 %, als konservative Heuristik rund 5,28 GiB; geschätztes Gemma/Projektor/KV/Runtime/OS-Budget 8,8 GiB. Die sichere Entscheidung heißt daher Start verschieben, nicht KAI Desktop oder unbekannte Prozesse schließen.
- Das macOS-Fenster wird beim Schließen nur versteckt; die App bleibt im Hintergrund aktiv. Das garantiert KEIN dauerhaft geladenes Modell: In der heute notarisierten App ist der Local-Brain-Start noch ein expliziter UI-Befehl.
- Git-Worktree-Erkennung, Writer-Lease-Sperren, HandoffPacket mit Branch/HEAD/ContextHash sowie SQLite/FTS5-Journal und RAG-Code existieren. Die automatische branchgenaue Zuteilung für ALLE Provider und ein echter gemeinsamer Agenten-Schreibpfad sind noch nicht integriert.
- Der bestehende Rolling-PROJECT_STATUS_FLOW-Projektor bietet Archivrotation, Index, Mailbox und Prüfsummen in einer Offline-Demo. Er schreibt keine echte PROJECT_STATUS_FLOW.md in Nutzerprojekte und synchronisiert keine Memory-Dateien über das Mesh. Memory-Quelle und Projektstatus sind somit noch nicht vollständig produktiv verbunden.

## Neuer Stage4K-Quellschutz

- src/lib/agentProviderBranchPolicy.ts: Eindeutige Namen nach Projekt, Ausführungsquelle, konkreter Provider-ID, Agent-ID und Job-ID; prüft Branch, Projekt-/Provider-Eigentum, Git-HEAD, Writer-Lease, Owner-Jobfreigabe und signierten Handoff. Stellt keinerlei Git-Schreibrecht aus.
- src/lib/localBrainResidencyPolicy.ts: gemeinsame CPU/GPU-Memory-Bilanz, verifizierte Runtime/Gewichte, aktuelle Speicherevidenz, OS-/KV-Puffer, sichere Deferred-/Resident-Zustände, niemals fremden Modellserver beenden.
- src-tauri/src/local_brain.rs: zusätzlicher macOS-Speicherdruck-Gate vor dem Modell-Spawn im isolierten Stage4J-QA-Feature; bei unsicherem Messwert oder zu wenig Reserve fail-closed, ohne fremde Prozesse zu berühren. Native Rust-Tests prüfen Parser und 16-GiB/35%-Ablehnung.
- scripts/qa-cross-project-status-index.mjs: reine Read-only-Übersicht aus den bestehenden Statusprojektionen, nur berechtigte Projekt-IDs, interne Archivintegrität geprüft, lokale Snapshot-Zusammenfassungen ausdrücklich nicht unabhängig autoritativ.
- Neue Node-Vertragstests: 19/19 bestanden. Zusaetzlich ein echter Git-Integrationstest mit zwei voneinander getrennten temporären Worktrees (Gemma/REX vs. Codex), beide unabhängig geändert und committed, main unverändert: 1/1 bestanden. Erste TypeScript-Prüfung bestanden; die aktualisierte Source-Version braucht vor Signierung noch die abschließende TypeScript-/volle Regression. Native Rust-Abnahme abgeschlossen: 2/2 gezielte Tests PASS (macOS-Speicherdruckparser sowie 16-GiB-Host mit 35-Prozent-Reserve unter Modellbudget). Rust-Code wird erst nach neuem signierten/notarisierten QA-Build wirksam.
- KEIN unkontrolliertes Git-worktree-add, kein Checkout, keine Schreibrecht-Vergabe, kein Projekt-Memory-Export, keine automatischen Agenten-Mails, kein Deployment oder Cloud-Token-Verbrauch.

## Harte nächste Freigabegates

1. Local Brain: nativen Speichergate abnehmen, Auth/Owner-/Lizenzzustand mit dem Auto-Warmup verknüpfen, Health/Crash/Memory-Watchdog, Busy-Lease, eigene Modellstart-/Stop-/Resume-Regeln. Auf 16-GiB-Macs darf eine fehlende Reserve nicht mit Gewalt oder dem Töten von KAI Desktop kompensiert werden. Der Koordinator kann unabhängig von einer schweren Modellinferenz weiterlaufen; echte lokale Antworten nur bei verfügbarem, verifiziertem Modell.
2. Agent Branch Manager / Conflict Guard: Worktree-Erstellung und Quellzuordnung erst nach tatsächlicher Git- und Owner-Validierung, exklusiver Writer-Lease je Job, zeitgestempeltem Audit, Tests/Review vor main, sauberem Handoff mit branchgebundenem ContextHash und Wiederaufnahme bei Offline-Betrieb.
3. PROJECT_STATUS_FLOW.md / Memory: einen einzigen, projektgebundenen SQLite-Continuity-Journal-Writer verwenden; danach signierte Agenten-Einträge, crash-sichere atomare Markdown-/Obsidian-Projektionen, Archiv-/FTS-Index, Scope-/Git-Head-/Lease-Prüfung, Konflikt-Rückführung und verschlüsselte M2/M3-Synchronisation. Nicht blind Last-Write-Wins oder Modelltext als kanonische Wahrheit behandeln.
4. M3-ModelGuard-Freigabe und reale Modellinstallation; danach menschlich bestätigtes SAS/mTLS, echte Mesh-Aufträge und begrenzte Agenten-Parallelität.
5. Neuer notariserter Release-Build nur nach grünen nativen Tests und unabhängiger Hardware-QA. Third-Party-Lizenz-/Source-Pflichten bleiben Release-Blocker.

## Abschließender Regressionseingang

- 19 von 19 gezielten Node-Regeltests für Branch-Namensräume, Cross-Project-Index, Unified-Memory-Residency und Modell-Eigentum bestanden.
- Zusätzlicher realer Git-Worktree-Integrationstest: 1 von 1 bestanden (Gemma-/Codex-Branches unabhängig, main unverändert).
- Gesamte Node-Regressionssuite mit test-concurrency=2: **897/897 bestanden, 0 Fehler**, kein Test-Timeout gelockert.
- Native Rust-Abnahme mit stage4j-qa: **2/2 bestanden**, Parser- und 16-GiB-Speicherreserve-Gate.
- Abschließende vollständige TypeScript-Typprüfung (tsc --noEmit) PASS; Rust-Formatprüfung PASS.
- Bestehende notarisierten Apps auf M2/M3 wurden nicht ersetzt. Native Source-Änderungen benötigen vor einem Live-Test weiterhin einen neuen signierten/notarisierten Stage4K-Build.

Entscheidung: STAGE4K_SOURCE_SECURITY_POLICY_PASS; LIVE_BRANCH_AUTOMATION, MEMORY_FILE_SYNC, ALWAYS_WARM_LOCAL_MODEL sind weiterhin OFFEN. Die aktuell notarisierten Apps wurden nicht verändert.

Created by NMKato Solutions