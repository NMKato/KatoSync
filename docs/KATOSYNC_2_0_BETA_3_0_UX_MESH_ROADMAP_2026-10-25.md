# KatoSync 2.0 Beta und 3.0 UX-/Mesh-Ziel (25.10.2026)

## Aktueller Versionsstand
- 2.0.0 ist laut Paket- und Tauri-Konfiguration der Beta-Stand.
- 3.0 bezeichnet die geplante, noch nicht freigegebene Mesh- und Multi-Agenten-Generation.

## Gemeinsame Produktoberfläche
- Chat: lokales Offline-Modell und projektbezogener, kontrollierter Kontext.
- Mission Control: echte Projektstände, Status, Freigaben, Aufgaben und Provider-Readiness.
- Vision / Network OS: ehrlicher interaktiver Graph zu Agenten, Modellen, Geräten und Projekten.
- Jobs & Queue: trennscharfe Diagnosejobs, sichere Queue, Human Gates und Verlauf.
- Provider: Zugänge/Modelle konfigurieren; bestehende Branding-Assets wiederverwenden.

## Öffentliche GitHub-Tickets
- #125: Beta-Blocker; beide Read-only-Providerläufe scheitern und die UI zeigt nur eine pauschale Meldung.
- #126: UX und Navigation Chat + Mission Control + Network OS.
- #127: zunächst read-only Mesh mit autorisierten Geräten und nachprüfbaren Quittungen.
- #61: bestehendes Thema Logos in Vision anstelle von CL/CO.
- #76: Writer-/Lease-/Approval-Gate vor Autostart oder parallelen Schreiboperationen.
- #114: Auth-Issuer von KatoSync und KATOOS-Web differieren, kein stilles SSO.

## Aktuell nachgewiesener Fehler und Diagnose
Ein Anwender konnte bei registriertem KatoSync-Projekt weder Codex noch Claude im neuen Read-only-Dispatcher erfolgreich starten. Im UI erscheint eine generische Meldung, keine Job-ID. Die unmittelbare Ursache ist noch NICHT bestätigt.
Die Projekt-Registry existiert, und Git-Lesebefehle sowie kanonische Git-Wurzel sind außerhalb des App-Dispatchers erfolgreich überprüft.
Diagnose-Fix auf separatem Draft-Branch: neuer Button Vorab prüfen (ohne Agentenstart), dieselbe native Validierung für Konto, Registry und Git wie im Dispatcher. Nur feste, harmlose Fehlercodes, keine Quellpfade, Zugangsdaten oder Logs im UI.

## Abnahme-Reihenfolge
1. Mac-Test-App: Vorab prüfen für registriertes KatoSync-Projekt wählen. Status erfassen, noch keinen Agentenstart.
2. Auth-/Registry-/Git-Probleme gezielt korrigieren. Erst wenn Vorabprüfung grün, einen einzelnen Codex-Diagnosejob starten.
3. Job-ID, Zeit, Status, Git-Vorher/Nachher und Persistenz prüfen; dann erst Claude.
4. Native Windows/macOS-Paketierung, Wechsel der Konten und Mesh-Read-only-Pilot gesondert testen.
5. 2.0 Stable beziehungsweise 3.0 erst nach erfüllten Release- und Sicherheits-Gates freigeben.

## Öffentlichkeitsgrenze
Keine Secrets, Kennwörter, privaten Pfade, Tokens, Nutzerkennungen oder internen Infrastrukturdetails im öffentlichen Repository.


## Nachtrag 29.10.2026: Mesh Stage 2L/2M – isolierter Entwicklungsstand
- Die auf M2/M3 signierten QA-Apps wurden zuvor auf identischen FTS5-Stand abgeglichen; FTS5-Memory-Fabric-Tests waren positiv. Stabile Version unangetastet.
- Stage 2L: serverseitige, gerätegebundene Ed25519-Einladungs-Queue als **nicht ausgerollter** Draft #177; PostgreSQL-Trigger gegen Replay, Anfragespitzen und doppelte aktive Einladungen.
- Stage 2M: native `mesh_inbox_invite_prepare`-Funktion liest die **bestehende** Geräteidentität, prüft die Owner-Registry und signiert eine konkret an das Zielgerät gebundene, kurzlebige Einladung. Übersetzte UI-Schaltfläche im isolierten QA-Code. **Noch kein Versand**, keine Annahme, kein SAS und kein mTLS.
- Stage-2M-Prüfungen: 357 Node grün, 225 Rust grün (8 manuelle/inaktive Tests ignoriert), TypeScript/Build/Rustfmt grün. Release-Gate verweigert erwartungsgemäß ohne echte geprüfte Ressourcen.
- Nächster Pfad: signierte Inbox-Zustellung nur nach ausdrücklichem QA-Rollout, dann zielgeräte-signiertes Lesen/Annehmen/Ablehnen, beidseitige SAS- und TLS-1.3-Abnahme. Bis dahin `discovered` statt `trusted`; Remote-Writer gesperrt.


## Nachtrag 30.10.2026 – Stage 2N: QA-gesperrte Einladungszustellung

- Native, ausdrücklich ausgelöste \`mesh_inbox_invite_send\`-Funktion mit frischer Ed25519-Signatur und Recipient-Binding. Niemals private Schlüssel im Frontend.
- Drei getrennte QA-Gates: Rust-Build, UI-Build, Edge-Dienst; ohne vollständigen Rollout keine Zustellung. Erfolgsquittungen sind strikt \`deliveryOnly\`, \`paired=false\`, \`transportReady=false\`, \`remoteJobsEnabled=false\`.
- 361 Node-Tests, 227 aktive Rust-Tests (8 bewusst ignoriert), TypeScript/Vite/Rustfmt bestanden.
- **Noch kein** Live-Deployment, kein M2→M3-Versand, kein Empfänger-Posteingang oder Annehmen/Ablehnen, kein sicherer mTLS-Peerkanal.
- Roadmap Stage 2O: frische zielgerätegebundene Challenges, signiertes Inbox-Listing und atomare Annehmen/Ablehnen-Entscheidungen mit TTL/Replay-Sperre. Danach Stage 2P SAS und TLS-Transport.
- Unverändert: beide Macs nur \`discovered\`; keine Remote-Ausführung und keine schreibenden Agentenrechte.

## Nachtrag 30.10.2026 – Stage 2O: empfängergebundene Inbox, vorbereitet

- Neuer streng QA-gesperrter Edge-Empfangsdienst mit frischer Ed25519-Recipient-Signatur je List/Accept/Reject. Ein Konto allein genügt ausdrücklich nicht; mindestens zusätzlich eigener Geräteschlüssel, Geräte-Registry und aktive KatoSync-Mitgliedschaft nötig.
- Migrationsentwurf entzieht authentifizierten Clients die direkte Einladungstabellen-Lesefreigabe. \`mesh_inbox_proofs\` bewahrt 90s Nachweise einmalig auf, mit Unique-Nonce und 12 Anfragen/Minute. Atomic pending→accepted/rejected verhindert Entscheidungsrennen; Quell- oder Zielgerätewiderruf sperrt Entscheidungen.
- Native Rust-Tauri-Kommandos \`mesh_inbox_recipient_list\`/\`mesh_inbox_recipient_decide\`; QA-only Schaltflächen und mehrsprachiger Status. Native Prüfung der ursprünglichen Sender-Signatur und Zielbindung unabhängig vom Edge-Dienst.
- 375 Node-Tests, 229 aktive Rust-Tests (8 bewusst ignoriert), TypeScript/Vite/Rustfmt und isolierte PostgreSQL-17-Tests bestanden.
- **Nicht deployed/aktiviert:** keine reale Einladung, keine angenommene M2/M3-Nachricht und keine bestehende vertrauenswürdige Peer-Verbindung. Stage 2P ist SAS/key-pin/mTLS-Hardwareabnahme; nur danach getrennte Freigabe von Read-only-Remote-Tasks. Kein Writer.


## Nachtrag 30.10.2026 – Stage 2O.1: Empfänger-Proof direkt an Entscheidung gebunden

- Reviewfund: Bisher war die Ed25519-Gerätebestätigung nur im Edge-Dienst, nicht als FK/Trigger-Vertrag der tatsächlichen Invite-Entscheidung verankert.
- Neue additive Migration \`20261030074910_mesh_resolution_proof_binding.sql\`: \`resolution_proof_id\`, UNIQUE/FK und Trigger für exakt denselben Eigentümer, Empfänger, Antrag und Akzeptieren/Ablehnen-Vorgang, inklusive noch gültigem Proof. Quellschlüsselwechsel nach Versand sperrt die Entscheidung.
- Edge-Nachweisquittung von PostgREST muss exakt mit der frisch eingetragenen Proof-Zeile übereinstimmen, sonst wird abgebrochen. Proof-ID kommt nur aus dem Backend; kein JS- oder Geräteparameter.
- Negativtests für fehlenden/falschen Proof, falsche Aktion, falsche Einladung, Schlüsselrotation und zweite Entscheidung; temporärer PostgreSQL-17-Cluster erfolgreich.
- **380/380 Node**, **229/229 aktive Rust** (8 bewusst ignoriert), TypeScript/Vite/Rustfmt und Release-Blocker geprüft. Live-DB weiterhin unverändert, keine M2/M3-Neuinstallation.
- Nächste Gates: gesonderter gestapelter Sicherheitsreview/QA-Rollout, M2/M3 echte Inbox- und Widerrufstests, Stage 2P SAS + Key-Pinning + mTLS. Kein automatisch verbundenes Mesh und kein Writer.


## Nachtrag 30.10.2026 – Stage 2P Hardware-QA: synthetisches mTLS M2↔M3

- **M2 und M3 real erreichbar, per LAN verbunden und geprüft:** bestehende \`mesh_tls.rs\`, \`mesh_transport.rs\` und \`mesh_admission.rs\` auf beiden Macs byte-identisch (jeweils SHA-256 verglichen).
- Positiver Test: M2 als einmaliger privater TLS-1.3/mTLS-Server und M3 als Client, gegenseitige künstliche Gerätezertifikate und gepinnte Schlüssel, 1/1 PASS auf beiden Macs.
- Negativer Test: M3 mit **absichtlich falschem Pin** zurückgewiesen, erwarteter Fehlschlag 1/1 PASS auf beiden Macs. Keine stille Ersatzauthentifizierung, kein Remote-Auftrag.
- Gefahrenabstand: **nur künstliche Testschlüssel (41/42/43)**, keine reale Keychain-/Kontodaten, nicht die installierte QA-App; 0 verbleibende QA-Listener, temporäre Build-Placeholders entfernt, App SHA-256 auf beiden Macs weiterhin identisch und unverändert.
- Reproduzierbarkeit: neues explizit erlaubnispflichtiges \`scripts/qa-mesh-two-mac-synthetic.sh\` (manueller one-shot, sonst fail-closed), abgesichert durch Node-Vertragstests.
- **Nicht erledigt:** Stage 2L–2O.1 Migrationen/Edge live, realer Invite-E2E mit Keychain-Geräten, persönlicher beidseitiger SAS, echte Session-Pins/Revocation und nachhaltiger TLS-Kanal. 0 trusted, kein Remote-Reader/Writer. Erst nach separatem realen Hardware-QA darf der UI-Status "Verbunden" lauten.

- Wiederholungsprüfung erfolgreich: M2-Launcher mit explizitem `KATOSYNC_MESH_LAN_QA_SCAFFOLD=YES` gegen M3-Testclient, auf beiden Seiten 1/1 PASS. Temporäre Build-Scaffolds per Exit-Trap entfernt; ohne Flag keine automatische Anlage fehlender Release-Ressourcen.

## Nachtrag 30.10.2026 – Stage 2Q: verbindliches read-only Rollout-Preflight

- Live-Abgleich belegt: genau 3 Basis-Migrationen installiert; die Stage 2L/2O/2O.1-Migrationen und beide Inbox-Edge-Dienste noch nicht installiert. 2 discovered, 0 trusted, 0 Invites, 0 revoked; 1 Owner. Bestehender owner-RLS-Client-SELECT bleibt bis zum Stage2O-Change aktiv.
- Neuer rein offline arbeitender `scripts/qa-mesh-inbox-rollout-gate.mjs` prüft einen unabhängig read-only erhobenen anonymisierten Snapshot. Pinnt SHA-256 der drei sicherheitskritischen SQL-Migrationen und erwartet die vollständige geordnete Kette, keine Teilmigration, richtige Berechtigungen, richtige Gerätebasis sowie strikt getrennte QA-Flags. Der Code führt keine Schemaänderungen, Edge-Deployments oder Remote-Jobs aus.
- Echter Live-Baseline-Snapshot: `BASELINE_MATCHES_REVIEW_ONLY`, mit weiterhin `connected=false`, `remoteJobsEnabled=false`, `remoteSessionReady=false`. Lokale gestapelte PostgreSQL-Migrationen erneut mit `MESH_INBOX_RESOLUTION_PROOF_BINDING_PASS` überprüft.
- Nächstes Gate: Unabhängige Sicherheitsfreigabe von Migration- und Edge-Rollout, danach erneuter Live-Schema-/Rechteabgleich, echter M2→M3-Keychain-Invite-E2E, gegenseitiges SAS und echte TLS-Admisson. Keine automatische Installation, kein Writer.

## Nachtrag 30.10.2026 – Stage 2R: Inbox prüft Absender auch serverseitig

- Im Stage-2Q-Sicherheitsreview wurde eine Lücke entdeckt: Vor der LIST-Ausgabe prüfte Edge bislang Empfänger-Signatur und Tabellenstruktur, nicht zusätzlich die ursprüngliche Absender-/Empfänger-Dispatch-Signatur. Der native Client validierte zwar eigenständig, aber das Backend reichte signaturungeprüfte Datensätze weiter.
- Stage 2R: Gemeinsame Ed25519-Offer-/Dispatch-Verifikationsfunktion für Send und Receive, zusätzlich owner-gefilterte aktuelle Absender-Registry mit Schlüsselgleichheit und Widerrufsprüfung. Jede ungültige Quelle blockiert die Inbox-Ausgabe vollständig, leerer Posteingang verursacht keine Source-Abfrage. Proof-Ablauf nochmals nach Absenderprüfung kontrolliert.
- Echte synthetische WebCrypto-Ed25519-Tests für positive LIST und Ablehnung von widerrufenen, fremden, nicht vorhandenen, umgeschlüsselten, manipulierten oder nicht verfügbaren Quellen. Keine neuen Migrationen, keine Remote-Rechte und keine Live-App-Änderung. Echte M2/M3-Keychain-/SAS-/mTLS-Freigabe weiter ausstehend.

## Nachtrag 30.10.2026 – Stage 2S: Empfängerschlüssel bis zur Inbox-Entscheidung binden

- Sicherheitsfund: Vor Stage2S speichert der einmalige Edge-Proof keinen expliziten Snapshot des **verifizierten Empfänger-Public-Keys**. Eine spätere Rotation konnte im DB-Resolution-Trigger nicht gegen die ursprüngliche Verifikationsidentität verglichen werden.
- Neue vierte Inbox-Migration `20261030093323_mesh_inbox_recipient_key_continuity.sql` (nach 2L, 2O, 2O.1): additive nullable Key-Spalte mit NOT-VALID-Check für historische Proofs, neue INSERT- und UPDATE-Trigger `SECURITY INVOKER`, `FOR SHARE`-Rowlock, aktuelle Owner-/Geräte-/Key-/Nicht-Widerruf-Kontinuität. Server-Edge sendet ausschließlich den im signierten Registry-Check verifizierten Schlüssel, validiert ihn im Speicherbeleg, nie einen Client-Schlüssel.
- Lokal PostgreSQL17 voll gestapelter Integrations- und negativer Key-Rotation-/Widerrufstest grün: `MESH_INBOX_RECIPIENT_KEY_CONTINUITY_PASS`. Predeployment-Gate kontrolliert nun **vier** Inbox-Migrationen inklusive neuer Schema-/Trigger-Fingerprints. Keine Live-Datenbankänderung, keine reale Gerätefreigabe.

## Nachtrag 30.10.2026 – Stage 2T: echte SQL-Transaktionen im synthetischen End-to-End-Inbox-Test

- Neuer manueller QA-Modus `bash scripts/qa-mesh-postgres-local.sh inbox-edge-e2e`: Beide unveränderten produktiven Edge-Handler werden mit echtem PostgreSQL17-Backend und vollständigem (Basis + vier Inbox) SQL-Migrations-Stack ausgeführt. Ein lokaler, hart begrenzter PostgREST-Adapter übersetzt die echten REST-Anfragen in SQL `SET ROLE service_role`; Auth/Membership bleiben ausschließlich synthetisch.
- Independent WebCrypto Ed25519 für Mac-A/Mac-B, kompletter Flow `SEND → LIST → ACCEPT`, Nonce-Replay- und Zweitentscheidung verweigert, zweite Einladung `REJECT`, dritte Einladung mit Source-Key-Rotation blockiert, Empfänger-Key-Rotation zwischen Proof und PATCH real vom Stage2S-DB-Trigger verweigert. **Keine** Vertrauens- oder Fernzugriffsfreigabe.
- Isolierter PG-Cluster nur per Unix-Socket, TCP-Port ausdrücklich abgeschaltet und geprüft, temporäre Testdaten nach Ausführung entfernt. Die echte Supabase-DB, Keychains und beide installierten Apps sind davon unberührt.
- Nächstes Gate: unabhängiges Schema/Edge-QA-Rolloutreview, später erst echte M2↔M3-Zustellung, beidseitiger SAS und echte gepinnte mTLS-Sitzung.

## Nachtrag 30.10.2026 – Stage 2U: signierter M2↔M3-LAN-Nachweis

- Erstmals über **zwei physische Macs** tatsächlich getesteter, beidseitig signierter Test-Nachrichtenaustausch: M2 sendet mit frisch erzeugtem Ed25519-Schlüssel signiertes Original-Angebot plus empfängergebundene Dispatch-Signatur über TLS 1.3 zum M3. M3 überprüft den gepinnten SHA256-TLS-Serverzertifikat-Fingerabdruck und beide Ed25519-Signaturen, erzeugt eigene recipient-v1-Nonce/Signatur und sendet sie an M2; M2 verifiziert sie und antwortet strikt `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`.
- **Negativtest** am realen M3: absichtlich falscher Zertifikats-Pin zurückgewiesen; Positivtest M2/M3 mit übereinstimmendem Skript-SHA256 und Exit-Code 0. Nur private LAN-Adressen und Port 49331; Skript startet standardmäßig ohne ausdrückliches Synthetic-QA-Opt-in überhaupt nicht.
- Abgrenzung: keine echten Mac-Keychain-Identitäten, keine authentifizierte Supabase-Inbox und kein Nutzer-SAS; es ist **kein** produktives Geräte-Pairing. Stage2T deckt getrennt echte SQL-/Edge-Transaktionen ab, Stage2P getrennt synthetisches gepinntes mTLS; diese drei QA-Strecken dürfen nicht mit einer endgültigen Realgerätefreigabe gleichgesetzt werden.
- Nächstes Gate: vier Inbox-Migrationen + beide Edge-Dienste kontrolliert prüfen/ausrollen, danach echte M2↔M3-Keychain-/SAS-/mTLS-Verbindung mit Widerrufskontrolle.

## Nachtrag 30.10.2026 – Stage 2V: plattformübergreifende Freigabeprüfung

- Im echten GitHub-Windows-Node-Lauf von PR #187 wurden **5 von 407 Tests rot**, obwohl die Mac-Prüfungen grün waren. Ursachen: zwei falsch mit `URL.pathname` statt `fileURLToPath` gestartete Node-Subprozesse, ein auf Windows fälschlich verlangtes POSIX-Bash-Programm und die von Git-Checkout zu CRLF umgewandelten vier SHA256-gepinnten SQL-Dateien.
- Stage 2V korrigiert die plattformgerechten Pfade und testet den POSIX-Shell-Helfer auf Windows nur statisch; auf macOS/Linux weiterhin mit negativem echten Start. Vier exakte `.gitattributes`-LF-Regeln halten die bisherigen geprüften SQL-Datei-Hashes auf allen Plattformen unverändert. Neuer regulärer CI-Regressionstest sichert die LF-Regeln und Pfadverwendung.
- **Rollout-Sperre bleibt bis zu einem neuen nachweislich grünen Windows-CI-Lauf aktiv**; keine geänderten SQL-Inhalte, kein Supabase-Deployment, keine echte Gerätekopplung.

## Nachtrag 30.10.2026 – Stage 2W: reproduzierbares, nicht-bereitstellendes Inbox-Edge-Paket

- Vier unveränderte SHA256-geprüfte SQL-Migrationen bleiben erforderlich. Zusätzlicher offline Edge-Release-Prüfer `scripts/qa-mesh-inbox-edge-package-review.mjs` verifiziert **fünf fest gepinnte Source-SHA256** und bündelt **beide realen Deno-Entrypoints** inklusive Membership-Gate und gemeinsamem Send/Receive-Kryptografieverifizierer ohne Dateischreibzugriff oder Internet. Die Ausgabe bleibt ausdrücklich `REVIEW_ONLY_NO_DEPLOYMENT`.
- Erfordert explizit den frisch erstellten, nicht-geheimen Live-Baseline-Snapshot; jede Source-/SQL-Manipulation oder unerwartete Registry-/Edge-/Rechtesituation blockiert. Die JSON-Review-Ausgabe ist **keine Deployment-Autorisierung**.
- Nächstes echtes Gate: unabhängige Freigabe für vier SHA-gepinnte Migrationen, JWT-geschützte deaktivierte Edge-Funktionen und dokumentierten Restore-Plan auf dem gemeinsam genutzten KATOOS-Supabase-Projekt. Danach echter M2/M3-Keychain-Inbox-Ablauf, manuelle SAS-Übereinstimmung und gepinnter mTLS mit Revocation-Checks.

## Nachtrag 30.10.2026 – Stage 2X: Edge-Laufzeit ohne Netzwerk + Wiederherstellungs-Gate

- Zwei neue reguläre Node-Tests führen die **wirklichen, komplett gebündelten Edge-Einstiegspunkte und Handler** in einem hermetischen Node-Web-Request-/Deno-Serve-Testadapter aus. Beide bleiben ohne Stage-Flags mit `503 INBOX_NOT_CONFIGURED` geschlossen; falsche Origin, fehlendes Secret, fehlende Anmeldung und ungültige POST-Payloads werden vor jeglichem externen Abruf blockiert. Dies ist **kein echter Supabase-Edge-/JWT-Plattformtest**, aber stärker als der vorherige reine Build-Nachweis.
- Der read-only Live-Stand ist weiter 2 `discovered`, 0 `trusted`, 0 Einladungen und 0/4 Inbox-Migrationen. Der bereits vorhandene Supabase-Branch ist ausschließlich `main`, kein dedizierter QA-Branch. Die neue Betriebsdokumentation `docs/KATOSYNC_MESH_STAGE2X_RUNTIME_AND_RECOVERY_GATE_2026-10-30.md` legt zwischenhaltbare Rollout-Schritte, klare Abbruchbedingungen, Edge-Stop durch deaktivierte Stage-Flags und **kein automatisches SQL-Rollback** fest.
- Ein vollständiger Supabase-Restore kann KATOOS-Daten aus anderen Modulen zurücksetzen und Ausfallzeiten verursachen; ein tatsächlich verfügbarer Backup-/PITR-Punkt ist noch nicht belegt. Deshalb bleibt **NO-GO für Live-Migrationen**, bis Wiederherstellungsnachweis, RPO/RTO, unabhängige Betreiberfreigabe und ggf. Kosten für eine isolierte QA-Umgebung vorliegen.

## Nachtrag 30.10.2026 – Stage 2Y: echte Backup-Inventur mit PITR-Status

- Endlich über die echte Supabase-Management-API (CLI, read-only) nachgewiesen: **8 abgeschlossene physische Sicherungen** vom 23.–30. Oktober 2026 im KATOOS-Projekt `xbnnlyyxiilklsygxcof`, letzte am **30.10.2026 06:07 UTC**. `walg_enabled=true`, **`pitr_enabled=false`**; ein Restore wurde NICHT durchgeführt oder verifiziert.
- Neuer standardmäßig verweigernder Prüfer `scripts/qa-mesh-backup-readiness.mjs --live-read-only`: exakt **eine** Backup-Liste (kein Restore, kein Projekt-/Branch-Bau, kein SQL/Edge-Deployment), strenge Validierung für Region/Backupalter/Fehler und ausschließlich aggregierte non-secret JSON-Ausgabe. **`recoveryReady=false`, `operatorApproval=false`, `authorizedToDeploy=false`** auch bei `COMPLETED`-Backups. Sechs neue reguläre Node-Tests.
- Nächstes Gate: belastbarer Restore-/RPO-/RTO-Nachweis oder separat kostenfreigegebene isolierte QA-Umgebung, ausdrückliche Freigabe für Shared-KATOOS-Liveänderungen. Bis dahin **4 Inbox-Migrationen und 2 Edges OFF**, reale Keychain-SAS/mTLS-Kopplung und Remote-Jobs weiter gesperrt.

## Nachtrag 30.10.2026 – Stage 2Z: lokale, echte pg_dump→pg_restore-Wiederherstellungsübung

- **Erfolgreich tatsächlich ausgeführt** auf dem M2: PostgreSQL 17 im nur lokal verfügbaren Unix-Socket, synthetic Ed25519 Mesh Edge→PostgreSQL E2E mit 2 Geräten/3 Einladungen/0 Trust, dann echtes komprimiertes `pg_dump` der ganzen temporären Testdatenbank und `pg_restore` in ein separates `recovered`-DB im selben isolierten Cluster.
- Datenfingerabdrücke stimmen nach Restore exakt; **RLS, authenticated-Verbote, Service-Grant, sechs Inbox-Trigger und Empfänger-Key-Constraint** auch in der wiederhergestellten DB bestätigt. Eine nachträgliche Testdatenmutation der Quelle beeinflusst die restaurierte Kopie nicht. **No TCP**, Default-Deny, Cleanup automatisch, 0 KATOOS-Liveänderungen.
- Separater expliziter Wiederholungsaufruf `KATOSYNC_MESH_RESTORE_QA_ALLOW=DISPOSABLE_UNIX_SOCKET_ONLY bash scripts/qa-mesh-postgres-recovery-drill.sh`, vier reguläre Node-Contract-Tests und Detailbericht `docs/KATOSYNC_MESH_STAGE2Z_DISPOSABLE_POSTGRES_RESTORE_2026-10-30.md`.
- **Achtung:** Dies beweist KEIN Restore eines echten Supabase-Backups, kein PITR, RPO/RTO oder Cloud-Services-Recovery. Shared-KATOOS-Deployment weiterhin gesperrt. Nächstes Gate: kostengeprüfte isolierte Supabase-QA-Umgebung und dort tatsächliche Restore-Abnahme.

**Ergänzende Live-Clone-Sperre (30.10.):** `pg_cron` und `pg_net` sind im geteilten Supabase-Projekt installiert; `cron.job` weist 1 geplanten und 1 **aktiven** Job aus. Die Supabase-Dokumentation bestätigt, dass solche Jobs nach physischem `Restore to New Project` automatisch anlaufen können. **Deshalb kein ungesicherter physischer KATOOS-Cloud-Klon**; Isolation potentieller Nebenwirkungen ist zuerst nachzuweisen. Die lokale Restore-Fixture enthält keine Live-Jobs und ist davon unabhängig.

## Nachtrag 30.10.2026 – Stage 3A: synthetische QA statt physischem Cloud-Klon

- **Offline-QA-Freigabeplan** `scripts/qa-mesh-isolated-fixture-plan.mjs --offline-synthetic` prüft byteidentische vier Stage2L/O/O.1/S-Migrationen und beide kompletten SHA-gepinnten Edge-Bundles, erlaubt nur die vorhandene **synthetische** Auth-/Mesh-Fixture und die feste Migrationsreihenfolge. Fremde Includes, `pg_cron`/`pg_net`, HTTP-/Vault-/Storage-Seiteneffekte und destruktives SQL werden blockiert. Keine Cloud- oder produktive Datenbankverbindung.
- Der tatsächlich wiederholte lokale `pg_dump`→`pg_restore`-Test bestätigt nun **explizit die Abwesenheit** von externen `pg_cron`-/`pg_net`-Extensions und `cron`-/`net`-Schemas vor und nach Restore. In KATOOS live sind diese Erweiterungen dagegen vorhanden, dazu **1 aktiver Cron-Job**. Daher bleibt ein physischer Cloud-Klon verboten, solange dessen potentielle Netzwerk- und Job-Seiteneffekte nicht vor der Erstellung isoliert sind.
- Supabase veröffentlicht für Micro-Preview-Branch **ab US-$0.01344/h** (24 h ca. $0.32, 7 Tage ca. $2.26); weitere Usage-Kosten möglich, Branch-Compute nicht durch Credits/Spend-Cap gedeckt. **Das ist kein organisationsspezifisches Angebot und keine Kostenfreigabe.** Es wurde kein kostenpflichtiger Branch angelegt.
- Stand und wiederholbarer QA-Aufruf: `docs/KATOSYNC_MESH_STAGE3A_ISOLATED_QA_FIXTURE_2026-10-30.md`. Nächster Schritt: ausdrückliche Preis- und Cloud-QA-Freigabe nach Prüfung der automatischen Schema-/Job-Replikation; erst dann JWT-/PostgREST-/Keychain-SAS-Tests. Kein Live-Deploy, kein Trust, keine Remote-Jobs.

## Nachtrag 30.10.2026 – Stage 3B: echter Deno-HTTP-Test auf M3

- Auf dem M3 wurde **Deno 2.9.6** ausschließlich als QA-Werkzeug in einem separaten Ordner auf der Entwicklungs-SSD bereitgestellt. Acht von acht tatsächlichen lokalen **HTTP-Server-Tests** der echten, SHA256-geprüften `mesh-inbox-send`- und `mesh-inbox-receive`-Handler bestanden. Es wurde nur der QA-Listener der im Speicher gebündelten Module auf `127.0.0.1` umkonfiguriert; Handler und Originaldateien unverändert.
- Alle Deno-Prozesse: ausschließlich Loopback-Netzwerkberechtigung, kein Zugriff auf externe Hosts, keine realen Secrets, keine Supabase-Cloud. Je Dienst: deaktiviertes Stage-Flag, falsches Flag, fehlendes Server-Secret (alle 503), sowie eingeschalteter synthetischer QA-Flag mit GET 405, unberechtigtem POST 401 und falschem POST 400. Vier neue regelmäßige plattformübergreifende Sicherheits-Tests.
- **Weiterhin nicht** echte Supabase Edge Runtime/Gateway-JWT/PostgREST, kein bezahlter QA-Branch, kein echtes M2↔M3-Trust/Keychain-SAS/mTLS, keine Remote-Jobs. Siehe `docs/KATOSYNC_MESH_STAGE3B_REAL_DENO_LOOPBACK_2026-10-30.md`; bis zur gesonderten Betreiber-/Kostenfreigabe gilt NO-GO für Live-Deployment.

## Nachtrag 30.10.2026 – Stage 3C: native TLS-1.3-mTLS-Hardware-QA zwischen M2 und M3

- **Erstmals real auf zwei physischen Macs getestet:** bestehende, manuell gestartete Rust-Funktionen `mesh_transport::server_probe` (M2) ↔ `client_probe` (M3) über privates LAN, TLS 1.3 **gegenseitig Ed25519-zertifikatsgeprüft**, 40-Byte-Hello mit Nonce-Echo. Positiv: auf beiden Macs erfolgreich. Negativ: absichtlich falscher Public-Key-Pin führt zum erwarteten Verbindungsabbruch auf beiden Macs. Rein synthetische Identitäten, **kein** Keychain-/Supabase-Write.
- Nachgehärtete Rust Hardware-QA verlangt bei falsch gepinntem Peer den **spezifischen Zertifikat-Identitätsfehler**, nicht nur generischen Netzwerkfehler; nach beiden Szenarien müssen `verifiedPeers=0`, `remoteReadOnlyDispatch=false` und `crossDeviceWrites=false` bleiben. Beidseitiger expliziter QA-Starter `scripts/qa-mesh-native-two-host.sh` nur nach `SYNTHETIC_FIXTURES_ONLY`, mit lokalen Rollen/IPs und ohne Cloud-Zugriffe. CI prüft den Vertrag ohne LAN-Verbindung.
- Details und Wiederholung: `docs/KATOSYNC_MESH_STAGE3C_NATIVE_TWO_MAC_MTLS_2026-10-30.md`. **Noch offen:** produktives Keychain-basiertes SAS- und KATOOS-Enrollment/Trust-Ende-zu-Ende, Cloud-JWT/PostgREST, dauerhafte Peer-Session, Widerruf und Remote-Jobs. Release-/Inbox-Cloud-Freigabe bleibt NO-GO.

## Nachtrag 30.10.2026 – Stage 3D: nativer SAS→Freigabe→mTLS-Sicherheitsverbund

- **Neu tatsächlich ausführbar:** Ein zusammenhängender Rust-Test verbindet unveränderte produktive signierte Account-Scope-Offer/Challenge/Response-Funktionen, gleichen SAS auf A/B, unabhängige explizite lokale Zulassung auf beiden Geräten, echte pinned TLS-1.3-mTLS-Probe über lokalen Betriebssystem-TCP-Socket und den Widerruf einer Zulassung. Synthetische Ed25519-Schlüssel und lokale reine In-Memory-Freigabelisten; **keine OS-Keychain-Mutation, kein KATOOS-Login, keine Supabase-Schreibvorgänge**.
- Negative Prüfungen: falscher Konto-Scope, inkorrekter SAS, abgelaufene Original-Challenge, nur einseitige Freigabe, fremder oder eigener Schlüssel, entfernter Pin. Nach erfolgreicher TLS-Probe weiterhin `verifiedPeers=0`, `remoteReadOnlyDispatch=false`, `crossDeviceWrites=false`. Zwei `#[cfg(test)]`-Helfer gehen direkt durch die echten produktiven SAS-/Admission-Prädikate und werden nicht im Release kompiliert.
- Vier zusätzliche reguläre Windows-/Node-verträgliche Vertragsprüfungen. Vollständiger Test- und Freigabeumfang: `docs/KATOSYNC_MESH_STAGE3D_SAS_APPROVAL_TLS_LIFECYCLE_2026-10-30.md`.
- **Noch nicht**: realer App-UI-Dialog mit manuellem Vergleich auf M2/M3, tatsächliche Keychain-Persistenz, zwei serverseitig dem **selben** KATOOS-Testkonto zugeordnete Geräte, echte Cloud-JWT-/PostgREST-Integration oder Remote-Aufträge. Keine automatische Zusammenführung, kein Live-Deployment, Release-Lock unverändert.

## Nachtrag 31.10.2026 – Stage 3E: Guided Mesh Connection Card

- **Bedienlücke tatsächlich behoben:** Primäres „Verbinden“ öffnet nun die **Geräteauswahl** mit ausschließlich read-only `mesh_account_devices_list`, anstatt direkt eine rohe manuelle JSON-Einladung zu erzeugen. „Geräte finden“ bleibt ein separater expliziter Nutzerklick auf die bereits existierende signierte native Registrierungs-/Discoveryfunktion; keine implizite Keychain- oder Cloud-Registrierung beim Öffnen der Karte.
- Zielgerät konkret auswählen; erst ein **weiterer expliziter Klick** kann – ausschließlich unter den bereits vorhandenen QA-Gates – eine signierte Inbox-Einladung versenden. Ohne Sende-QA wird höchstens ein signiertes Draft vorbereitet; sonst sauber gesperrt. QA-Posteingang und Annehmen/Ablehnen sind jetzt in der **sichtbaren geführten Karte** statt im technischen Bereich. Kein falscher „Verbunden“-Status, weil Antrag/Annahme allein keine mTLS-Session und keine Gerätefreigabe sind.
- Manuelles Ed25519/SAS-/Keychain-Sicherheitswerkzeug bleibt in Details; neue responsiv gestaltete Light-/Dark-Mode-Karten und DE/EN/ES/RU-Lokalisierung. **448/448 Node-Tests, TypeScript, Vite-Build sowie echter isolierter Chromium-Browserdurchlauf** der Benutzerinteraktionen bestanden; keine Backend-Daten in diesem Browser-Test verändert.
- Details: `docs/KATOSYNC_MESH_STAGE3E_GUIDED_CONNECTION_CARD_2026-10-31.md`. **Offen:** echter freigegebener Keychain-SAS-Endnutzerlauf M2/M3, isolierte Cloud-JWT/PostgREST/Edge-QA, persistenter Peer und überprüfter Widerruf, produktiver Installer/Release. Kein Merge oder Cloud-Deployment.

## Nachtrag 31.10.2026 – Stage 3F: Inbox-UI-Race und Ablaufzeiten

- **Behobene konkrete Ausfälle:** Senden, signiertes Draft, Posteingang abrufen, Annehmen/Ablehnen und Gerätelisten-Aktualisierung besitzen jetzt direkte synchrone In-Flight-Gates, sodass schnelle Doppelklicks **keine doppelten nativen Requests** auslösen. Epoch-/Token-Prüfungen verwerfen späte Antworten nach Status-/Kontowechsel; erneute Anmeldung setzt Geräteliste und Einladungsstände zurück.
- Ablaufzeit im Browser deterministisch: abgelaufene Einladungen werden herausgefiltert, der nächste Ablauf wird über einen einzelnen aufräumbaren Timer aktualisiert (kein Cloud-Poll). Nach erfolgreichem Versand bleibt die gleiche Sendeaktion bis zum erneuten bewusst gewählten Such-/Refresh-Schritt gesperrt. Reale Rust-/Edge-Signatur- und Autorisierungstests sind weiterhin Voraussetzung; **kein** stilles Pairing oder Remote-Auftrag.
- **452/452 Node, 230/230 aktive Rust-Tests, TypeScript und Web-Build bestanden.** Physischer M2 Chromium/Playwright: verzögerter synthetischer Server, zwei unmittelbare Sende-Klicks → genau ein Send; abgelaufener Inbox-Eintrag wird entfernt; zwei unmittelbare Annehmen-Klicks → genau eine Entscheidung. Kein falscher Verbunden-Status. Details: `docs/KATOSYNC_MESH_STAGE3F_INBOX_RELIABILITY_2026-10-31.md`.
- Das externe **M3 DevSSD** war während Stage 3F nicht gemountet; keine eigenmächtige Volume-Änderung. Echte Supabase-Inbox, M2/M3-Keychain-SAS, Freigaben und produktiver Installer bleiben offen/gesperrt.

## Nachtrag 31.10.2026 – Stage 3G: Annahme → verifizierte native Challenge

- Die native Inbox gibt das **erst nach Ed25519-Offer- und Dispatch-Signaturprüfung** verifizierte öffentliche Sender-Offer an die Karte; keine Secrets oder Vertrauens-Claims. Nach gesondertem explizitem **Annehmen** ist ein weiterer Klick auf „Sicherheitsnachweis vorbereiten“ notwendig, um die vorhandene native `mesh_pairing_challenge_create` mit exakt dem angenommenen Offer aufzurufen. Kontrolle auf gleiche Originalnachricht, gültiges Ablaufdatum, Double-Click-Gate und Account-/Refresh-Widerruf.
- **456/456 Node und 231/231 Rust aktiv**, TypeScript, Web-Build, Rustfmt grün; echter Chromium-/Playwright-Klickpfad mit synthetischer Tauri-API: genau ein Challenge-Call erst nach ausdrücklicher Anwenderaktion, kein automatisch gekoppelter Peer. `docs/KATOSYNC_MESH_STAGE3G_VERIFIED_INBOX_HANDOFF_2026-10-31.md`.
- **Offen:** signierter Challenge-/Response-Rücktransport im Inbox-/Backend, echter SAS-Vergleich und autorisierte Keychain-Freigabe auf beiden Geräten, native mTLS-Session im normalen App-Betrieb, automatischer Widerruf und produktive Inbox-Edge-Dienste. Die vorhandene Stage3C-Hardware-Kryptoprobe ist kein Ersatz für diesen E2E-Test. M3 `/Volumes/DevSSD` nicht gemountet; M2 nur wenig freier Speicher. Keine produktiven Änderungen.

## Nachtrag 31.10.2026 – Stage 3H: getrennter signierter QA-Rückkanal (Backend)

- Neuer, **standardmäßig gesperrter** `mesh-pairing-relay`-Edge-Handler mit `qa-relay`-Freigabeschalter, JWT+KatoSync-Membership+signierter Gerätebesitzprüfung. Ed25519-Signaturen binden Konto, Einladungs-ID, Geräte, Challenge/Response, Nonce, Ablaufzeit und öffentlichen Payload. Native innere Ed25519-Challenge-/Response-Signaturen sowie Original-Offer werden separat verifiziert. PostgreSQL-JSONB-Schlüsselreihenfolge wird vor Rust-kompatiblen Hashes kanonisiert.
- Eigene noch **nicht** ausgerollte SQL-Migration `20261031213900_mesh_pairing_relay_staged.sql`: zwei RLS-gesperrte, Service-Role-only Tabellen, ein Eintrag pro Einladung/Schritt, signierte lesende Nonces einmalig, 12 Abfragen/Minute, DB-Trigger für akzeptierte Einladung, gültige Geräte, Rollen, Widerruf und Expiry. Vorhandene vier Inbox-Migrationen bleiben unverändert.
- **Isoliertes End-to-End** mit echten synthetischen WebCrypto-Ed25519-Schlüsseln, gemocktem REST für Challenge B→A / Response A→B und positivem echten PostgreSQL-17-Unix-Socket-Test inklusive RLS, Replay, Rollen und Rate-Guards. `docs/KATOSYNC_MESH_STAGE3H_STAGED_SIGNED_RELAY_2026-10-31.md`.
- **Kein fertiger App-Rückkanal:** Stage 3I muss explizite native Tauri-Signier-/Send-/List-Befehle und die Mesh-Karte anschließen, die inneren Nachrichten lokal prüfen und im GUI bewusst bestätigen lassen. Danach echte SAS- und Keychain-Freigabe auf M2/M3. Das M3-DevSSD war zuletzt nicht eingehängt. Kein Cloud-Deployment, kein Trust, keine Remote-Jobs, kein Release.

## Nachtrag 31.10.2026 – Stage 3I: Tauri + sichtbare Relay-Integration (QA-only)

- Die im Draft Stage3H vorbereitete signierte Challenge-/Response-Relay-Strecke ist jetzt mit der **native Tauri-App** verbunden: `mesh_pairing_relay_send` und `mesh_pairing_relay_list`, beide über authentifizierte KATOOS-Session und vorhandene, bereits registrierte OS-Keychain-Geräteidentität. Auth/Cargo/Native-QA-Flags + separater Web-QA-Flag + unverändert gesperrter Cloud-Edge-Gate. Keine implizite Erstellung oder Freigabe von Geräten. Empfänger-Liste prüft in Rust äußere Ed25519-Signatur, Rollen, registrierten Peer und **inneren** Original-Challenge-/Response-Nachweis, bevor JS den Public-Payload bekommt.
- **Mesh-Karte:** Separat und ausdrücklich klicken für Challenge senden, signierte Nachrichten abrufen, Response erstellen, Response senden, Response verifizieren. SAS wird nur nach echtem nativen Besitznachweis angezeigt; **niemals** als gekoppeltes Gerät. Kein automatisches Polling/Remote-Dispatch/Approval. Jede Funktion besitzt Double-Click-/Refresh-Guards und Konto-Reset, vier Sprachen ergänzt.
- **476/476 Node, 234/234 aktive Rust-Tests (8 ignored)**, TypeScript, Web-Build, Rustfmt und isoliertes echtes PostgreSQL-17-Audit grün. Drei echte isolierte Chromium-/Playwright-Bedienabläufe auf dem M2 mit **synthetischem** Tauri-IPC grün: Empfänger Challenge-Send, Initiator Response-Erzeugung/-Send und Empfänger Response-Verifizierung. `docs/KATOSYNC_MESH_STAGE3I_NATIVE_RELAY_UI_2026-10-31.md`.
- **Offen:** neuer Edge/SQL-Relay und vier Inbox-Migrationen weiterhin nicht ausgerollt, installierte QA-Apps nicht ersetzt, M3-DevSSD nicht eingehängt, echter M2↔M3-KATOOS-/Keychain-SAS- und native mTLS-Pairing-Test nicht durchgeführt. Daher kein produktiver Mesh-Verbindungsstatus oder Release.

## Nachtrag 31.10.2026 – Stage 3J: Reproduzierbarer Rust→Edge-End-to-End-Vertragsbeweis

- Neu: Testgenerierter öffentlicher Transkript-Satz **direkt aus den produktiven Rust-Serde-/ed25519-dalek-Nachrichtenfunktionen** (signiertes Original-Offer, Challenge B→A, Response A→B, zwei signierte Read-Proofs), ohne echte Keychains. Edge-WebCrypto prüft diesen Satz tatsächlich; nicht bloß eigene JS-Signaturen. Auch neu sortiertes PostgreSQL-JSONB wird akzeptiert; falsche Signaturen/Account/Role/Nonce/Expiry werden verworfen.
- Neu: zwei isolierte Edge-Handler-Tests mit denselben **Rust-signierten** Nachrichten und gefälschten JWT-/PostgREST-Backends für einen vollständigen B→A→B-Sende-/Leseweg sowie Replay-, Invite-, Widerruf- und Receipt-Schutz. Reproduzierbares Skript `scripts/qa-mesh-rust-edge-interop-stage3j.mjs` erzeugt pro Lauf frische öffentliche Rust-Testsignaturen im sicheren temporären Ordner, prüft sie mit Node-WebCrypto-/Edge-Handler-Tests und löscht die temporären Daten. Tatsächlicher M2-Lauf: **STAGE3J_RUST_SIGNED_INTEROP_PASS (7/7)**.
- Das ist **keine echte Cloud-/Geräteverbindung**. M3 `/Volumes/DevSSD` weiterhin ungemountet. Live Supabase 2 discovered/0 trusted, 0/5 neue Inbox-/Relay-Migrationen, kein neuer Edge aktiviert. Es fehlt noch ein ausdrücklich freigegebener isolierter JWT-/Postgres-/Edge-Betrieb mit beiden realen QA-Apps, anschließender SAS- und beidseitiger Keychain-Zustimmung, mTLS und Widerruf. Details: `docs/KATOSYNC_MESH_STAGE3J_RUST_EDGE_INTEROP_2026-10-31.md`.

## Nachtrag 01.11.2026 – Stage 3K: Rust-signierter Edge-Ablauf auf echtem Wegwerf-PostgreSQL

- Der neu kombinierte lokale QA-Lauf erzeugt **frische echte Rust/Serde/Ed25519-Signaturen** für Challenge B→A, Response A→B und beide signierten Abrufe. Er führt die unveränderte Edge-Verifikation aus und speichert/liest Daten in einer **echten kurzlebigen PostgreSQL-17-Datenbank** mit vier Inbox- und der fünften Relay-Migration. Keine In-Memory-SQL-Attrappe.
- Positiv: beide Sende-/Lesewege. Negativ: Datenbank-Trigger verweigert Response vor Challenge; SQL-Unique sperrt Abruf-Replay; Edge sperrt Signaturmanipulation und ein in SQL widerrufenes Gerät. Testlauf auf dem M2: `STAGE3K_RUST_EDGE_REAL_POSTGRES_PASS`; Rustfmt, Bash-Syntax und Git-Diff-Checks ebenfalls erfolgreich.
- **Bewusste Grenzen:** Online-JWT/Membership und HTTP-PostgREST sind lokal simuliert, ebenso die SQL-vorbereitete Annahme der Einladung. Kein Supabase-Cloud-Deployment, keine echten Keychain-/SAS-Zustimmungen, kein physisches M2↔M3-Pairing, kein Installer oder Remote-Job. `paired=false`, `transportReady=false`, `remoteJobsEnabled=false` bleiben gesperrt.
- Details und Reproduktion: `docs/KATOSYNC_MESH_STAGE3K_RUST_EDGE_POSTGRES_2026-11-01.md`. Nächster Übergang: unabhängig genehmigte isolierte Cloud-JWT/Edge/PostgREST-QA mit Recovery-Nachweis; erst danach physischer Zwei-Mac-Test. Die KatoSync-2.0-Blocker #125/#130 bleiben eigene Priorität.

## Nachtrag 01.11.2026 – Stage 3L: synthetische JWT-Verifikation über realen Loopback-HTTP-Transport

- Stage 3K wird mit ausdrücklichem, lokalem QA-Opt-in um einen echten HTTP-Listener auf `127.0.0.1` erweitert. Die Auth-Schicht prüft ein frisch synthetisch HMAC-signiertes JWT (Issuer, Audience, Rolle, Session-ID, Ablaufzeit, Signatur) und verweigert manipulierte/abgelaufene/fremde Sitzungen. REST-Zugriffe benötigen die synthetische Service-Role und die erwartete Route/Methode. Der Edge-Handler bleibt unverändert; seine mit Rust/Serde/Ed25519 erzeugten Nachrichten durchlaufen echte temporäre PostgreSQL-Transaktionen.
- Verifizierter M2-Lauf: `STAGE3L_SIGNED_JWT_LOOPBACK_EDGE_POSTGRES_PASS`. Dazu zwei Node-Tests für kryptografisches JWT-/Loopback-Fail-closed-Verhalten. Negative: JWT-Tampering, Ablaufzeit, fremder Account, fehlende REST-Berechtigung, unbekannte Route, SQL-Response-before-Challenge, Nonce-Replay, Signaturmanipulation, Widerruf. Keine Gerätefreigabe.
- Heute rein lesend bestätigtes gemeinsames KATOOS-Supabase: 1 main-Branch, 2 discovered/0 trusted/0 Einladungen; 0/5 Inbox-/Relay-Migrationen und neue Edge-Funktionen nicht deployed; 1 aktiver `pg_cron`-Job sowie `pg_net`. Weiterhin **keine** isolierte Cloud-QA oder Produktionsfreigabe.
- Wichtig: Der HMAC-JWT und lokale HTTP-Server sind ein **eigener synthetischer QA-Gateway**, nicht GoTrue oder Supabase Gateway/JWT/PostgREST in der Cloud. Echte KATOOS-Anmeldung und M2↔M3-Keychain-/SAS-/mTLS-Zulassung bleiben offen. Details `docs/KATOSYNC_MESH_STAGE3L_SIGNED_JWT_LOOPBACK_2026-11-01.md`. Weiterhin Draft, kein Deploy, Merge, kostenpflichtiger Branch oder Remote-Writer.

## Nachtrag 01.11.2026 – Stage 3M: Fail-closed Tenant-/Issuer-Herkunft für Relay-Preview

- Bestätigter Cloud-QA-Blocker: Relay, Inbox und Rust-Mesh-Signaturen waren fest an KATOOS-Produktiv-Supabase gebunden. Ein isolierter Preview-Branch kann nicht durch bloßes Umschalten von `SUPABASE_URL` getestet werden; `accountScope` bindet Ed25519-Angebote ebenfalls an die Ursprungsadresse.
- Stage 3M sichert **zunächst nur den Relay-Teil** mit explizit aktiviertem `isolated-preview-only`, exakter QA-Projektreferenz und passender `DENO_DEPLOYMENT_ID` ab. Auth, Mitgliedschaft, Gerätenachweise, Einladungen, Relay-Lese-/Schreibtransaktionen und die Ed25519-`accountScope`-Prüfung verwenden nun denselben validierten Origin. Produktionsstandard bleibt unverändert; gemischte/fehlerhafte Konfigurationen werden vor Netzverkehr abgelehnt.
- Offline-Gates: 4 neue Mandantenprüfungen bestanden, 13 bestehende Relay/JWT-Tests bestanden. Dokumentation: `docs/KATOSYNC_MESH_STAGE3M_ORIGIN_BOUNDARY_2026-11-01.md`.
- **Noch nicht abgeschlossen:** Inbox- und Enrollment-Origin, native Rust-Geräte-/SSO-Grenze, echte GoTrue-JWT, isolierter QA-Branch mit Kosten-/Restorefreigabe und beidseitiges SAS/mTLS. Alle Änderungen bleiben Draft, keine Cloud-Deployments/Remote-Writes/Installer oder Produktivfreigabe.

## Nachtrag 01.11.2026 – Stage 3N: Relay-LIST-Proof v2 mit signiertem Supabase-Origin

- Grundproblem: Stage3M hat v1-Reads in anderen Supabase-Mandanten gesperrt, weil das signierte v1-Abruf-Proof keine Projektadresse enthält. Stage3N ergänzt ein **eigenständiges v2-Protokoll**, dessen Ed25519-Signatur die komplette exakte Ursprungsadresse `https://<project-ref>.supabase.co` in den Preimage aufnimmt. Die Edge-WebCrypto-Prüfung verweigert jede Herkunftsabweichung sowie zusätzliche, fehlende oder veränderte Felder.
- Bestandskompatibilität: Produktions-v1 bleibt gültig, Preview-v1 gesperrt. Preview-v2 kann den rein lokalen Edge-Read mit simuliertem JWT/Membership und PostgREST-Adapter bestehen. Dieser Read setzt keinerlei Geräte-Trust, Remote-Jobs oder Transportfreigabe.
- Ein nur mit `#[cfg(test)]` gebauter Rust/Serde/Ed25519-Signer liefert einen public-only v2-Testnachweis; die native produktive Tauri-Anwendung schaltet **nicht** ungeprüft auf Preview um. Dokumentation `docs/KATOSYNC_MESH_STAGE3N_ORIGIN_BOUND_READ_V2_2026-11-01.md`.
- Die echten verbleibenden Schritte sind projektgebundenes Inbox-Send/Receive + Enrollment, eine verifizierte native Auth-/Issuer-Bindung, sichere Cloud-Preview mit Kosten-/Restorefreigabe, erst danach echte M2↔M3-SAS-/Keychain-/mTLS-Abnahme. Kein Produktiv-Merge oder Deployment im Rahmen Stage 3N.
