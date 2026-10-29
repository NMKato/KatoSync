# KatoSync Mesh Stage 2L – serverseitig gebundene Einladung (29.10.2026)

## Umfang / Sicherheitsgrenze

Die bestehende `katosync.mesh_invites`-Tabelle kann eine authentifizierte, kryptografisch an ein konkretes zweites Gerät gebundene Einladung aufnehmen. Diese Änderung ist **nur in einem gestapelten Draft-PR** vorbereitet: Weder die SQL-Migration noch die neue Edge Function wurden in Supabase ausgerollt. Keine Änderungen an der installierten M2-/M3-QA-App, an Nutzerkonten, Geräteschlüsseln oder bestehenden Chatdatenbanken.

Der neue Edge-Dienst `mesh-inbox-send` nimmt nur POST-Anfragen an, und auch das nur bei ausdrücklich gesetztem `KATOSYNC_MESH_INBOX_STAGE=send-only` und der zugelassenen KatoSync-Serveradresse. Die Verbindung ist ansonsten fail-closed (503).

## Vertrag

`katosync-mesh-inbox-send-v1` enthält `sourceDeviceId`, `targetDeviceId`, eine native signierte `MeshOffer` und eine **zweite**, vom sendenden Geräte-Ed25519-Schlüssel erzeugte `dispatchSignature` über:

`katosync-mesh-inbox-send-v1|accountScope|sourceDeviceId|targetDeviceId|offerNonce|offerExpiresAt`

Der native Original-Offer-Proof verwendet unverändert:

`katosync-mesh-pairing-v1|accountScope|publicKey|nonce|expiresAt`

Der Server prüft streng vollständige Felder, Base64url, Offer-Zeitfenster, Account-Scope-SHA256, beide Ed25519-Signaturen, Online-Auth über Supabase Auth, aktive **KatoSync-spezifische** Mitgliedschaft sowie beide auf denselben Owner registrierten, nicht widerrufenen Geräteschlüssel. Vor dem Schreibzugriff wird die KatoSync-Mitgliedschaft erneut geprüft.

Es wird nur die bereits signierte öffentliche Einladung samt Zielbindung persistiert; weder Access-/Refresh-Tokens noch private Keychain-Daten oder Projektquelltexte. Der Server antwortet mit einem begrenzten, zeitlich gültigen Queue-Beleg (`deliveryOnly=true`, `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`).

## SQL / Ressourcenlimits

Die neue noch nicht veröffentlichte Migration `20261029211243_mesh_inbox_signed_send_guard.sql` ergänzt ein obligatorisches signiertes Ziel-Bindungsfeld und einen transaktionsbasierten, per Owner serialisierten Insert-Trigger. Dieser verhindert:
- mehr als 3 Neueinladungen pro Konto innerhalb 60 Sekunden;
- eine zweite gleichzeitig aktive, nicht abgelaufene Einladung vom gleichen Quell- an dasselbe Zielgerät;
- ungültige Fristen und wiederverwendete Offer-Nonces (bestehende UNIQUE-Constraint).

Für `anon` und `authenticated` bleibt `mesh_invites` ohne direkte Schreibberechtigung und unter Owner-RLS; ausschließlich der serverseitige Service erhält die erforderlichen Schreibrechte. **Die zusätzliche Spalte ist absichtlich NOT NULL**; Rollout setzt Migrations-/Backup-Review voraus.

## QA-Nachweise

- **9/9** gezielte Node/WebCrypto-Tests bestanden: gültige Signatur, falscher Empfänger, fehlerhafte Payloads, Ablauf, falscher Owner/Key, widerrufenes Gerät, ungültiger Login, fehlende KatoSync-Mitgliedschaft, Datenbankfehler, Rate/Replay.
- **353/353** vollständige Node-Suite bestanden, TypeScript-Prüfung und Vite-Build bestanden.
- Isolierte **PostgreSQL-17**-QA mit privatem Unix-Socket, TCP deaktiviert: Originalschema und neue Migration angewendet; Trigger-, Replay-, Fremd-Owner- und RLS-Negativfälle bestanden. Testcluster wird nach Ausführung zerstört.
- Kein Live-Endpoint und keine manuell/fälschlich bestätigte Mesh-Verbindung.

## Noch offene Freigabestufen

1. Native Tauri-Kommandos zur signierten Erzeugung einer konkreten Empfänger-Zielbindung und einer echten Geräteinhaber-Proof für Inbox-Reads/Decisions; nicht aus JS behaupten.
2. Edge-Inbox-Listing und Annehmen/Ablehnen mit **zielgerät-gebundener Signatur**, Session-Recheck, Single-use-/Race-Lock, Zustellung/TTL, Ablehnung und Ablauf. Akzeptanz ist *noch keine* Gerätefreigabe.
3. Beidseitige Challenge/Response, bewusste SAS-Freigabe und vertrauenswürdige Schlüssel-Pins; danach echter mTLS-Kanal, negative Revocation-/Session-Tests.
4. Isolierter Rollout und zwei reale Macs, Rückbau/Backup, unabhängige Prüfung der RLS-/SQL-/App-Gates.
5. Erst nach bewiesener Verbindung: Heartbeat, gemessene Qualität und gesonderte Read-only-Auftragsrechte. Remote-Writer weiterhin gesperrt.

Die UI darf bis dahin keine tatsächliche Verbindung, automatisches Pairing, Fernausführung oder Qualitätsmessung behaupten.
