# KatoSync 4.0 – Trust Gate 4B: kryptografische Owner-Freigabe (QA)

**Stand:** 04.11.2026. **Draft / kein Release.** Gestapelt auf PR #234. Bestehende M2-/M3-/Windows-Installationen, Mesh-Freigaben und produktive KATOOS-Daten bleiben unangetastet.

## Sicherheitsziel

Eine erfolgreiche KATOOS-Authentifizierung über den bereits vorhandenen Supabase-GoTrue-Identitätsanbieter belegt **nur das Konto**, nicht die projektbezogene Berechtigung zur Abnahme. Auch eine lokale Ed25519-Signatur alleine darf keinen MVP-Fortschritt freischalten.

Der native Rust-Baustein `owner_authority.rs` erwartet stattdessen **zwei getrennte digitale Signaturen**:

1. Ein zeitlich begrenztes **Issuer-signed Approver Grant** über das konkrete KATOOS-Konto, genau das Projekt und die Rolle `project_owner` oder `feature_approver` mit explizitem Recht `approve_feature_acceptance`. Der Grant enthält den Base64url-kodierten Ed25519-Owner-Public-Key, dessen `ed25519-sha256:`-Fingerprint, eine Grant-Revision, Status, Ausstellungszeit und Ablauf.
2. Ein **Owner-signed Feature-Receipt**, das mit exakt diesem im Grant referenzierten Owner-Key verifiziert werden muss. Receipt-Projekt, Eigentümerkonto, Schlüssel-Fingerprint und Zeitstempel müssen zusammenpassen.

Der gesamte Grant-Vertrag ist durch eine kanonische JSON-Array-Signatur mit separatem Domain-Separator `KatoSync owner-approval-grant v1\n` vor Manipulation geschützt. Der Issue/Public-Key des Issuers darf **nicht** aus dem Grant oder einem Browser-Parameter kommen, sondern muss als vertrauenswürdiger Schlüssel getrennt hinterlegt sein.

## Fail-closed-Prüfungen

- Account-ID ist eine gültige UUID und muss exakt dem frisch bei `/auth/v1/user` überprüften Konto entsprechen.
- Projekt und Schlüssel-ID stimmen mit dem konkreten ausstehenden Ledger-Receipt überein; falsche und rotierte Schlüssel werden abgewiesen.
- Nur ausdrücklich berechtigte Rollen und `active` ohne `revokedAtMs`; suspendierte, widerrufene oder lesende Rollen werden abgelehnt, auch bei gültiger Signatur.
- Nur aktuelle Grants (maximale Alterung 90 Sekunden, maximale Gültigkeitsdauer fünf Minuten, begrenzte Clock-Skew). Zeit-Arithmetik als 128 Bit verhindert Überlauf durch manipulierte Integer.
- Receipt-Abnahmezeit muss innerhalb der gültigen Grant-Laufzeit liegen. Abweichende ältere/future Zeitstempel werden verworfen.
- JSON-Antworten sind auf 4 KiB begrenzt, unbekannte Felder und fehlende Issuer-Signaturen werden zurückgewiesen.
- Die neue interne Wrapper-Funktion prüft das KATOOS-Konto **vor und nach** der externen GitHub-/Git-Evidenzprüfung erneut, um Konto-Wechsel während langer Abfragen abzuwehren.
- Weiterhin **keine** Tauri-/Webview-Schreib-API, kein Accepted-Ledger-Writer, keine Erhöhung von `verifiedPercent`, keine Agenten-/Mesh-/Release-Freigabe.

## Vor einer echten produktiven Abnahme zwingend offen

1. KATOOS-Backend-Authority für Projektfreigaben und Schlüsselregistrierung **serverseitig real bereitstellen**. Die Freigabetabelle muss gegen Self-Service-Schreibrechte geschützt sein (RLS + Administrationsworkflow). `user_metadata` oder selbst vergebene Client-Rollen sind keine Berechtigungsquelle.
2. Native Vertrauensanker für den Issuer-Public-Key über signierten Release-/Konfigurationskanal ausrollen, inklusive Schlüsselrotation und Root-Key-Recovery. Der Nutzer liefert nicht eigenständig eine beliebige Issuer-Key-Konfiguration zur Freigabe.
3. **Jede** Prüfung muss einen frisch serverseitig erzeugten oder online bestätigten Grant abfragen und aktuelle Sperrlisten/Widerrufe berücksichtigen; ein historischer signierter Grant alleine garantiert bei vorzeitigem Widerruf keine sofortige Sperrung. Die jetzigen 90 Sekunden sind eine zusätzliche Schranke, **kein Ersatz** für aktuelle Server-Autorität.
4. Echten Live-KATOOS-Grant und echte GitHub-Run-/Job-Abnahme eines registrierten Projekts mit dem Scope-Gate kombinieren, inklusive Offline-, Account-Switch-, Widerruf-, Key-Rotation- und Replay-E2E.
5. Erst nach echtem Owner-, Scope-, CI- und Git-Beweis separate immutable **Accepted-Receipts** schreiben und diese read-only für Projektfortschritt und konservative ETA verwenden.

## Laufender Speicherstatus (nicht destruktiv)

Auf dem M2 wurden ~38–41 GiB frei beobachtet. Die reine Übersicht zeigt rund 84 GiB unter `~/Projects`, davon ~9,4 GiB im aktiven Rust-Build-Target; außerdem ~6,2 GiB in `~/Library/Caches` und ~7,7 GiB in `~/Downloads`. **Keine Löschung durchgeführt.** Vor größeren Builds/Notarisierung empfiehlt sich die gesonderte Sichtung von veralteten Worktrees/Build-Artefakten mit Backup und Anwenderfreigabe, Ziel ≥80 GiB.
