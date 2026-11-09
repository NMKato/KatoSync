# KatoSync Stage 2V – Windows-CI-Freigabeblocker und unveränderliche SQL-Dateien

**30. Oktober 2026.** Folge-Review zu [Draft-PR #187](https://github.com/NMKato/KatoSync/pull/187), Windows Node Regression [GitHub Actions Run 41042594538](https://github.com/NMKato/KatoSync/actions/runs/41042594538). Keine Änderungen an Live-Supabase, SQL-Migrationsinhalten, Keychain oder installierten Anwendungen.

## Tatsächlicher Windows-Befund

Der Windows-CI-Lauf meldete `402 pass, 5 fail` (407 Tests), während die macOS-Tests, Web-Build, Rust-Format bestanden.

**Fehlerursachen:**

1. `tests/meshInboxEdgePostgresE2eContract.test.ts` und `tests/meshTwoHostSignedInviteContract.test.ts` übergaben `URL.pathname` als Pfad an Node-Kinderprozesse. Auf Windows wurde dadurch beispielsweise aus `file:///D:/...` fälschlich `D:\D:\...`; der gewünschte Default-Deny-Code konnte nicht ausgeführt werden. Lösung: ausschließlich `fileURLToPath()`.
2. Der Test für den POSIX-Shell-Server-Helfer rief `bash` unter Windows auf, wo `bash` nicht garantiert vorhanden ist. Lösung: Der **vorbereitende Sicherheitsvertrag wird auf allen Betriebssystemen statisch geprüft**; der tatsächliche negative Bash-Start wird nur auf POSIX ausgeführt. Der echte M2/M3-Test bleibt unverändert.
3. Die vier als unveränderlich SHA-256-gepinnten SQL-Dateien wurden bei Windows-Checkout wegen fehlender `.gitattributes`-LF-Festlegung als CRLF ausgecheckt und deshalb zu Recht durch `MESH_ROLLOUT_BLOCKED:MIGRATION_HASH_CHANGED` blockiert. Lösung: `.gitattributes` schreibt für genau diese vier Dateien `text eol=lf` vor; die bisherigen Hash-Pins bleiben **identisch**, insbesondere `0d52bf08...`, `ca57d614...`, `cd1b2e9c...`, `358beec0...`. Jede echte Inhaltsänderung wird weiterhin abgewiesen.

## Zusätzliche Regression

`tests/meshWindowsCiCompatibility.test.ts` prüft, dass für jede der vier freigegebenen Migrationen eine exakt passende LF-Regel existiert, die tatsächlichen Quelltexte keinen `CR` enthalten, die vier Versionen durch die vorhandene SHA-256-Prüfung weiter bestätigt werden und die QA-Subprozesse plattformkorrekte Pfade verwenden.

Daraus folgt ausdrücklich **keine** Änderung an den Datenbank- oder Edge-Verträgen. Es ist ein portabler Test- und Release-Sicherheitsfix, kein Grund, Live-Datenbankmigrationen vorzeitig bereitzustellen.

## Freigabereihenfolge

Vor jedem Schema-/Edge-Rollout: neuer GitHub-Windows-CI-Lauf für diesen Stack, zusätzlich TypeScript/Web, Rust, Node und der isolierte PostgreSQL-E2E. Alle PRs im Stack sind weiterhin Drafts, der Release-Lock ist aktiv und es fehlen echte Keychain/SAS-/mTLS-Verbindungen. Auch bei grünem Windows-Lauf bleibt die **separate Freigabe für die gemeinsame KATOOS-Supabase-Instanz** zwingend.

**Status:** CI-Korrektur im Quellcode getestet; grüner Windows-CI-Folgelauf separat zu belegen. Keine Behauptung einer bereits bestandenen Windows-CI.
