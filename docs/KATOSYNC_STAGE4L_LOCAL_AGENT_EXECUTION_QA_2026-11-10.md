# KatoSync Stage4L – lokaler Agenten-Ausführungsschutz (QA, nicht freigegeben)

**Stand:** 10. November 2026, Europe/Berlin. Quelle: isolierter Branch qa/stage4l-provider-execution-20261110, Basis Stage4K 039d37e.

## Tatsächlicher M2-Live-Smoketest vor diesem Quellpatch

- Einmalig das **bereits signierte Stage4J-QA-Binary** mit --local-control-daemon auf dem M2 Pro gestartet. Separater QA-Control-Root, ursprüngliche Inbox leer.
- Atomar zwei ausschließlich lokale QA-Jobs eingereiht:
  - git status --short: **completed**, Exit **0**, Dauer **359 ms**. Das Log zeigte nur zwei bereits vorhandene untracked Release-Ressourcenpfade; keine Änderung am Repository.
  - git checkout --help im Modus read_only: **failed**, Exit null, korrekte Guard-Fehlermeldung vor Ausführung.
- Beide Ergebnis-Receipts liegen im isolierten Stage4J-QA-Control-Root. Der eigens gestartete QA-Daemon wurde nach Prüfung kontrolliert beendet, nicht dauerhaft aktiviert.
- **Kein** Cloud-/Mesh-/Provider-Auftrag; keine Modellinferenz und keine Nutzerprojekte bearbeitet. Der Test belegt nur den lokalen Backend-Transport vom Inbox-Job bis zum Receipt.

## Neu hinzugefügte Stage4L-Quellintegration

- src-tauri/src/local_control/agent_scope.rs: exakt getrenntes agent_read_only-Profil. Es erlaubt ausschließlich git status --short und git rev-parse HEAD, maximal 20 Sekunden.
- Native Prüfung von Projekt-ID, erlaubter lokaler Quelle, Provider-/Agent-/Job-Namensraum entsprechend Stage4K; kein main/unpassender Provider-/Branchzugriff.
- Bindung an **genau ein** registriertes Projekt, gleiche kanonische Git-Common-Directory wie der registrierte Repo-Stamm, Worktree-Root, tatsächlichen Branch und tatsächlichen Git-HEAD.
- Unbekannte/fehlende Felder, fremde Projekte, falsche Commits, Source codex/claude/Cloud/Remote, ungültige IDs und mutierende/ungeprüfte Shellbefehle werden abgelehnt.
- Das Agentenprofil erzwingt in macOS den gepinnten /usr/bin/git mit ausgeschalteten optionalen Locks und deaktiviertem FSMonitor.
- Vor dem Spawn sowie nach einem erfolgreichen Leseauftrag erneute Validierung. Agentenmodus überspringt den unsicheren, unvalidierten, Git-basierten Dedupe-Vorlauf und ignoriert ein untrusted dedupeKey.
- Keine allgemeine Befugnis aus JSON-Flags; **keine automatische Writer-Lease**, kein Provider-Worktree-Schreiben, kein Remote-/Mesh-Job, kein Merge.
- Bestehende Legacy-Lokaljobs behalten ihre bisherigen Modi. **Sie sind nicht als Sicherheitsgrenze für externe Agenten freigegeben**, insbesondere wegen des breiteren bisherigen Kommando-/Argument-Profils.

## Prüfstatus und ausstehende Abnahme

- Stage4K-Basis: PR #248, GitHub Fast Gate und Attribution Policy erfolgreich.
- Stage4L-Quellformatierung und git diff --check: geprüft; native vollständige Rust-Tests und neue positive reale agent_read_only-Registrierungs-/Branch-Ausführung bleiben bis zum vollständigen Compile offen.
- Ein neuer vollständiger Cargo-Test ohne vorhandenen inkrementellen Build-Cache begann mit proc-macro2, quote, syn; wegen knapper M2-Ressourcen wurde der eigene Compile-Prozess kontrolliert beendet. Kein erfolgreiches natives Stage4L-Testresultat behauptet.
- Die bereits installierte Stage4J-App enthält **nicht** diesen neuen Stage4L-Code. Neuer signierter/notarisierter QA-Build und echte Besitzerabnahme bleiben erforderlich.

## Release-Hold

1. Gesonderte dauerhafte Writer-Leases, echte Owner-/Session-/Client-Signaturen und Handoff-Verifikation hostseitig implementieren; nicht auf User-JSON verlassen.
2. Nachweis, dass **alle** künftigen Agenteneingänge den neuen Zulassungspfad verwenden, keine freie Legacy-Inbox-Weiterleitung für Remote-Aufträge.
3. Native Cargo-Tests, kontrollierte registrierte Projektfixture, Cross-OS-Strategie für Windows/Linux, Read-only-Job-Ausführung und Revoke/Account-Switch prüfen.
4. KatoSync-Gemma-Modellstatus separat und wahrheitsgemäß anzeigen; auf 16-GiB-Hosts fremde KAI/llama-Prozesse nicht beenden.
5. Für M2↔M3 erst echte SAS-/Keychain-/mTLS-Paarung, dann eine **explizit freigegebene** erste Remote-Leseaktion. Keine Cloud- oder DB-Freigabe, kein automatisches Merge nach main.

**Entscheidung:** Stage4L lokaler QA-Leseauftrag nachgewiesen; neue native Agenten-Zulassung als *Quelländerung*, noch nicht produktiv ausgeführt. Release bleibt NO-GO.

Created by NMKato Solutions
