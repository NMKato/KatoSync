# Stage 3X – Freigegebener Cloud-Schema-Rollout und getrennte macOS-QA-App

**02.11.2026 · KATOOS-Supabase** `xbnnlyyxiilklsygxcof` · `eu-central-1`

## Produktionsänderung

Nach ausdrücklicher Zustimmung zum täglichen physischen Backup **ohne PITR** wurden die fünf in Stage 3V lokal qualifizierten und in Stage 3W synthetisch wiederhergestellten SQL-Migrationen über die verbundene Supabase-Migrationsschnittstelle in der vorhandenen produktiven `katosync`-Schema-Grenze angewendet. Originalquellen: Commit `0473b1a` (`NMKato/KatoSync`), Migrationen 20261029211243, 20261030072543, 20261030074910, 20261030093323, 20261031213900.

Das Cloud-Migrationstool hat beim Anwenden **neue Versionsnummern vergeben**. Das müssen nachfolgende Gates beim Abgleich berücksichtigen:

| Datei-Versionsnummer im Git | Cloud-Migrationsnummer | Migrationsname |
| --- | --- | --- |
| 20261029211243 | 20261102143138 | mesh_inbox_signed_send_guard |
| 20261030072543 | 20261102143254 | mesh_recipient_signed_inbox_atomic_decisions |
| 20261030074910 | 20261102143424 | mesh_resolution_proof_binding |
| 20261030093323 | 20261102143501 | mesh_inbox_recipient_key_continuity |
| 20261031213900 | 20261102143529 | mesh_pairing_relay_staged |

Das Git-Migrationsverzeichnis bleibt als Quellenarchiv unverändert; die realen Versionsnummern sind oben vollständig dokumentiert. Bei zukünftigem CLI-Migrationsabgleich dürfen die fünf bereits angewendeten SQL-Dateien **niemals** versehentlich erneut ausgeführt werden. Ein neues versionsbewusstes Post-Rollout-Gate ist vor einem späteren `db push` erforderlich.

## Nachkontrolle

- KATOOS-Projekt war `ACTIVE_HEALTHY`; letztes abgeschlossenes physisches Backup: **2026-11-02 06:07:09 UTC** (07:07 Uhr MEZ); `pitr_enabled=false` blieb unverändert.
- Nach Migration: **acht Tabellen im Schema `katosync`, alle mit RLS**. Zwei registrierte Geräte, keine Trusted-/Revoked-Geräte, keine Einladungen, keine aktiven Inbox-/Relay-Datensätze.
- `anon`: keine Tabellenleserechte. `authenticated`: nur owner-basierter Lesezugriff auf `account_memberships`, `mesh_devices`, `mesh_owner_policy`; kein SELECT/INSERT auf `mesh_invites`, Proof- oder Relay-Tabellen.
- Transaktionsgebundener synthetischer `authenticated`-Fremdkontotest sah **0 Mitgliedschaften, 0 Geräte, 0 Richtlinien**.
- Keine Edge-Funktion für Inbox-Send/-Receive/Relay bereitgestellt; `mesh-device-enrollment` bleibt unverändert. **Keine echten Pairings, kein Transport und keine Remote-Jobs freigeschaltet.**
- Sicherheitsberater meldet die drei neuen Proof-/Relay-Tabellen mit RLS ohne Benutzer-Policies erwartungsgemäß; dies ist **beabsichtigte Server-only-Isolation**, keine Freigabelücke. Andere bestehende KATOOS-Sicherheitsbefunde werden durch dieses Projekt nicht pauschal als behoben erklärt.

## Signierte Stage3X-QA-App (getrennte Identität)

Neue Konfiguration `src-tauri/tauri.mesh-qa-stage3x.conf.json`: Bundle-ID `com.nmkato.katosync.meshqa.stage3x`, eigener App-Name. Build-Skript `scripts/build-mesh-qa-stage3x-macos.sh` verlangt eine signierte Stage2I-QA-Basis, einen explizit übergebenen lokalen Signaturbezeichner, vollständige QA-Build-Ressourcen und einen **noch nicht existierenden** Zielpfad `~/Applications/KatoSync Mesh QA Stage3X.app`. Es kopiert nach erfolgreichem Feature-`katoos-auth-qa`-Build die Basis-App, ersetzt ausschließlich die Binärdatei im **neuen** Bundle, ändert die Bundle-ID und signiert/verifiziert dieses Bundle. Die bisherigen Stable-/Stage2I-Apps dürfen nicht überschrieben werden.

**Grenze:** Eine neue QA-App ist erst dann installiert, wenn der signierte Build tatsächlich auf dem Mac entstanden ist und `codesign --verify --deep --strict` bestanden hat. Gleiches KATOOS-Konto ist noch **kein** Gerätevertrauen oder authentifiziertes Pairing; separate Bestätigung bleibt erforderlich.
