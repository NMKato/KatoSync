# KatoSync Mesh Stage 3K – Echte Rust-Signaturen durch Edge und lokale PostgreSQL-Transaktionen

**1. November 2026 · NMKato Solutions · DRAFT / QA ONLY**

## Nachweis

Stage 3J bewies Rust-Serde/Ed25519 ↔ Edge-WebCrypto mit gemocktem PostgREST. Stage 3H und 2T testeten unabhängig echte PostgreSQL-Migrationen. **Stage 3K kombiniert diese Prüfstrecken in einem Test.**

1. Ein ausschließlich für Tests verfügbarer Rust-Helfer erzeugt frische synthetische Testsignaturen für eine Einladung, Challenge B→A, Response A→B und zwei signierte Abrufe. Nur bestehende Produktionsserializer und Signaturfunktionen werden verwendet, keine echte OS-Keychain.
2. Der lokale PostgreSQL-17-Cluster startet ausschließlich auf einem privaten Unix-Socket ohne TCP und installiert vier Inbox-Migrationen sowie die fünfte Relay-Migration. Nach Testende wird der Cluster entfernt.
3. Der Test legt die signierte synthetische Original-Einladung in SQL an und erzeugt einen synthetischen Annahme-Proof mit Datenbankbindung. Dies ist keine echte Einladung eines Benutzers oder dessen Zustimmung.
4. Der unveränderte Edge-Handler prüft die echten Rust-Signaturen. Nur Online-JWT-/Mitgliedschaftsprüfung sowie der HTTP-PostgREST-Transport werden simuliert. Nachrichten und Abruf-Proofs laufen durch tatsächliche PostgreSQL-Tabellen, Constraints und Trigger.
5. Positive Prüfungen: Challenge senden/abrufen und Response senden/abrufen. Negative Prüfungen: Response ohne Challenge (SQL), signierter Abruf-Replay (SQL), Signaturmanipulation (Edge) und Widerruf einer Gerätekennung in der **echten Testdatenbank** (Edge-Registrierungsprüfung).
6. Der Status bleibt immer paired=false, transportReady=false und remoteJobsEnabled=false.

## Ausführung

Auf autorisiertem macOS-Gerät mit PostgreSQL 17 und einem **bereits vorhandenen** Cargo-Target:

    CARGO_TARGET_DIR=/Pfad/zum/vorhandenen/target node scripts/qa-mesh-rust-postgres-stage3k.mjs

Erfolgsausgabe:

    STAGE3K_RUST_EDGE_REAL_POSTGRES_PASS

Der Runner führt Cargo mit --offline aus. Der frische öffentliche Testtranskript liegt kurzzeitig in einem Modus-0700-Verzeichnis (Datei 0600). Fehlende leere Tauri-Ressourcenplatzhalter und ein temporärer dist/index.html werden nur im isolierten QA-Worktree angelegt und in finally wieder entfernt. Weder ein Installer noch Produktionsressourcen werden erstellt.

Der nachfolgende PostgreSQL-Runner nutzt einen Wegwerfcluster, begrenzt das Netzwerk strikt auf den Unix-Socket und entfernt ihn über Exit-Trap. Online-Tokens und Zugangsdaten werden nicht an die Testprozesse weitergegeben. Der synthetische Transportadapter blockiert unerwartete HTTP-Ziele.

## Einschränkungen und Freigabegates

**Nicht nachgewiesen:** echte KATOOS-JWTs, Supabase Edge Runtime oder echter PostgREST über HTTP; signierter Live-Inbox-Dispatch; Cloud-Deployment; echte M2↔M3-Keychain-/SAS-Zustimmungen; produktiver gepinnter mTLS-Kanal; Read-only-Remote-Job; Release. Die synthetische Einladung ist ein Vorbereitungsdatensatz und darf nicht als live authentifizierte Einladung bezeichnet werden.

Stage 3J bleibt unverändert reproduzierbar mit festen Testzeitpunkten; die dynamische Testzeit ist ausschließlich via der Stage-3K-QA-Umgebungsvariable im Rust-cfg(test)-Helper aktiv.

**Nächster Schritt:** unabhängige Prüfung einer isolierten Cloud-JWT/Edge/PostgREST-Testumgebung und ihrer Recovery-/Kostenrisiken, dann freigegebene echte Gerätekopplung. Die Beta-Blocker #125 (Provider-Jobs) und #130 (Projekt-Chat) bleiben unabhängig offen.
