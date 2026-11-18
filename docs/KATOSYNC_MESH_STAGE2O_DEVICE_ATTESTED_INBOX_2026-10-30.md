# KatoSync Mesh Stage 2O – Gerätesignierter Posteingang und Einmalentscheidung

**30.10.2026 · ausschließlich isolierter Draft auf Stage 2N. Nicht in Supabase ausgerollt, nicht auf M2/M3 installiert.**

## Was implementiert ist

Der neue Edge-Endpunkt `mesh-inbox-receive` nimmt einen streng gebundenen Ed25519-Nachweis des **Empfängergeräts** entgegen. Derselbe Konto-Login ist nicht ausreichend. Der Nachweis hat sieben eindeutige Felder: `protocol`, `deviceId`, `action`, `requestId`, `nonce`, `expiresAt`, `signature`.

Die nativen Rust-Tauri-Kommandos `mesh_inbox_recipient_list` und `mesh_inbox_recipient_decide` erzeugen **bei jedem ausdrücklichen Bedienerschritt eine neue Signatur** aus dem bereits vorhandenen Schlüsselbund-Geräteschlüssel. Vor dem Signieren erfolgt der online-autorisierten Konto-/Geräte-Registry-Check. Private Seeds, Access-Tokens und Service-Role-Secrets werden nicht an JavaScript übergeben.

Der Signaturtext (UTF-8, `|` als Trennzeichen) ist:

`katosync-mesh-inbox-recipient-v1|ownerUserId|deviceId|action|requestId|nonce|expiresAt`

Für `action=list` wird ausschließlich die feste Sentinel-UUID `00000000-0000-4000-8000-000000000000` verwendet; für `accept` und `reject` die individuelle Einladungs-UUID. Der Nonce ist 32 Byte Base64url, die Beweisgültigkeit maximal 90 Sekunden. Das Backend prüft die Live-Supabase-Sitzung, gesonderte aktive KatoSync-Mitgliedschaft, Registry-Owner, Ed25519-Geräteschlüssel, Signatur und Frist.

Alle erfolgreichen Nachweise werden **vor dem Lesen oder Entscheiden** einmalig in `katosync.mesh_inbox_proofs` registriert. Die UNIQUE-Constraint verhindert Replay unabhängig von parallelen Funktionsinstanzen; ein DB-Trigger begrenzt pro Gerät/Konto auf 12 Beweise pro Minute. Jede Entscheidung ist ein atomar gefiltertes Update `pending AND expires_at > now()`. Ein zweites Accept/Reject erhält keine positive Quittung. Die DB verhindert darüber hinaus Zustands-/Owner-/Payload-Mutationen oder eine Entscheidung nach Widerruf eines der beiden Geräte.

## Datenzugriff

Die neue, noch nicht deployte Migration entzieht `authenticated` die direkte SELECT-Berechtigung auf `katosync.mesh_invites`. Erst der geprüfte Edge-Dienst darf **nur für das attestierte Zielgerät** dessen offenen, noch gültigen Posteingang lesen. `anon` und `authenticated` erhalten keine Schreib- oder Leserechte an der neuen Proof-Tabelle; RLS ist aktiviert. Der Dienst bleibt bis zum expliziten Serverflag `KATOSYNC_MESH_INBOX_RECEIVE_STAGE=qa-inbox` deaktiviert.

## UI und Sicherheitsgrenzen

Im Mesh-Bereich erscheinen die zusätzlichen QA-Aktionen **Posteingang prüfen**, **Annehmen** und **Ablehnen** nur bei `VITE_MESH_INBOX_RECEIVE_QA=1` und dem bekannten KATOOS-QA-Featureflag. Die nativen Befehle sind separat auf `KATOSYNC_MESH_INBOX_RECEIVE_QA=1` im Rust-Build gesperrt.

Das native Gerät prüft außerdem selbst die ursprüngliche signierte Offer, die Empfängerbindung, die Ed25519-Dispatchsignatur, die Einladungsfrist und eine nicht-trustende Serverquittung. Nach akzeptierter Einladung ist der Status weiterhin `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`. Eine angenommene Einladung **stellt weder mTLS noch SAS-Freigabe oder Fernauftragsrechte her**.

## Beweisstand

- 9/9 neue isolierte Edge/WebCrypto-Tests mit echten Ed25519-Testschlüsseln bestanden.
- 5/5 neue native/UI/i18n-Vertragstests bestanden.
- 375/375 vollständige Node-Tests bestanden.
- 229/229 aktive Rust-Tests bestanden; 8 bewusst ignorierte Tests.
- TypeScript-Prüfung, Vite-Build und Rustfmt bestanden.
- PostgreSQL 17: Unix-Socket-only Testcluster, reale gestapelte Migrationen, RLS-/Replay-/Nonce-Rate-/Atomicity-/Revocation-Gates erfolgreich, danach Testcluster entfernt.
- Nicht Teil dieses Ergebnisses: Live-Deployment, tatsächliche M2/M3-Posteingangseinträge, echte beidseitige Nutzerfreigabe, mTLS, Read-only-Agentenjobs oder Writer.

## Weitere Abnahme-Gates

1. PR #177/#178/#179/Stage 2O im Zusammenhang prüfen, Backup/DB-Migration anhand tatsächlicher Supabase-Privileges auditieren; erst dann getrennten QA-Rollout des `mesh-inbox-send` und `mesh-inbox-receive` erlauben.
2. Echte signierte M2→M3-Einladung testen; Inbox nur auf M3 abrufbar, Replay/fremde Geräte/abgelaufene Session/Widerruf/gleichzeitiges Accept-Reject negativ testen.
3. Mit Stage 2P bewusstes beidseitiges SAS, persistierte Key-Pins und echte mTLS-Verbindung implementieren und auf beiden Macs verifizieren.
4. Read-only-Remote-Tasks und Heartbeat/Qualität erst nach separater Freigabe; schreibende Aufträge bleiben dauerhaft hinter unabhängigem Autorisierungs-Gate.

**Nicht als „verbunden“ deklarieren, solange mTLS und SAS nicht auf echter Hardware bestätigt wurden.**
