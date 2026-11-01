# KatoSync Mesh Stage 3M – tenantgebundene QA-Relay-Herkunft

**01.11.2026 · NMKato Solutions · DRAFT / NICHT DEPLOYEN**

## Bestätigter Integrationsblocker

Unsere Mesh-Relay- und Inbox-Edge-Implementierungen waren fest an den KATOOS-Produktiv-Supabase-Origin gebunden. Das ist ein absichtlicher Sicherheitsriegel, verhindert jedoch eine wirkliche Erprobung auf einem unabhängigen Supabase-Preview-Branch. Nur die Umgebungsvariable `SUPABASE_URL` zu ändern würde nichts bewirken; zusätzlich verwendet die Ed25519-Angebotssignatur die Projektadresse als Bestandteil ihres `accountScope`.

**Stage 3M führt nur für den Relay-Pfad eine optionale, streng geprüfte Preview-Herkunft ein.** Der Produktions-Origin bleibt Standard. Der Relay-Pfad prüft vor dem ersten Netzwerkzugriff:

1. Produktiv: `SUPABASE_URL` muss genau dem unveränderten KATOOS-Origin entsprechen; gleichzeitig aktivierte QA-Overrides sperren den Aufruf.
2. Preview: ausschließlich `KATOSYNC_MESH_RELAY_QA_MODE=isolated-preview-only`, eine eigene genau 20-stellige Supabase-Projektreferenz, exakter URL-Ursprung `https://<ref>.supabase.co` ohne andere Hosts/Pfade/Ports, und ein `DENO_DEPLOYMENT_ID` im vorgesehenen Format, dessen Prefix mit dem QA-Projekt übereinstimmt. Der Produktiv-Origin wird als QA-Preview ausgeschlossen.
3. Nach Herkunftsauflösung verwenden Auth-/Mitgliedschafts-Prüfung, Devices, Einladungen, Relay-Nachrichten, Read-Proofs und die kryptografische `accountScope`-Prüfung durchgängig **denselben** Origin.
4. Vorher gültige, Rust-signierte produktive Offers werden beim Wechsel auf einen anderen Origin kryptografisch abgelehnt, selbst wenn ihre übrigen Ed25519-Signaturen korrekt sind.

## Verifizierte Offline-QA

- Neue Tests: **4/4** Herkunfts-/Mandantentrennungsprüfungen bestanden. Negative Fälle: QA-Override auf Produktion, fehlender/widersprüchlicher Ref/Deployment-ID, unzulässige URL, abweichender Signatur-Kontext, kein Netzwerk bei ungültiger Konfiguration.
- Bestehende Stage-3J-/3L-/3M-Tests: **13/13** bestanden. Native Rust→Edge→echtes Wegwerf-PostgreSQL Stage 3K/3L wird gesondert im QA-Kommentar des PR nachgewiesen.
- Kein M2/M3-Schlüsselbund, keine reale KATOOS-Anmeldung, keine Edge-Deployment- oder SQL-Änderung am produktiven Supabase-Projekt.

## Noch NICHT Cloud-freigegeben

Dies löst **nicht** die folgenden ausstehenden Punkte:

- **QA-Relay-LIST ist absichtlich gesperrt:** Das v1-Abruf-Proof signiert nur Owner, Device, Nonce und Ablaufzeit, aber keine Supabase-Projektadresse. Auch eine gültige Produktionssignatur darf damit keine Preview-Nachrichten lesen; erst ein nativ und in Edge gemeinsam getestetes origin-gebundenes v2-Proof hebt diese Sperre auf.
- `mesh-inbox-send`, `mesh-inbox-receive`, `mesh-device-enrollment` und die nativen Rust-Desktop-Signatur-/Loginpfade sind weiterhin ausschließlich auf die produktive KATOOS-Projektidentität festgelegt. Keine Mischkonfiguration verwenden.
- Das Vorhandensein einer geprüften QA-Origin-Zeichenfolge bestätigt noch **keinen tatsächlichen Supabase-Branch**, kein Billing, keinen PITR-Restore, keine isolierte Cron-/pg_net-Konfiguration und keine echte Supabase-GoTrue-JWT-Verifikation.
- Ein synthetischer Stage-3L-HTTP-/HMAC-JWT-Test ist kein GoTrue-/Supabase-Edge-Roundtrip.
- Echte Inbox-Einladungen, gegenseitiger Keychain-SAS, mTLS und Remote-Read-only-Jobs sind nach wie vor gesperrt. `paired=false`, `transportReady=false`, `remoteJobsEnabled=false` bleiben verpflichtend.

**Freigabevoraussetzung:** ein unabhängiger, kosten-/restoresicherer QA-Branch mit expliziter Operatorgenehmigung; alle beteiligten Inbox- und nativen Codepfade müssen auf denselben nachgewiesenen Issuer/Origin gebunden sein. Bis dahin Stage 3M ausschließlich Draft lassen; kein Merge, Deployment, Cloud-Branch, Device-Pairing oder Installer.
