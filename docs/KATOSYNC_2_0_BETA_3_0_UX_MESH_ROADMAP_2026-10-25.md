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
