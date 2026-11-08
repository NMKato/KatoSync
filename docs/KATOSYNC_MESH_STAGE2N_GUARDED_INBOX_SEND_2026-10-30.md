# KatoSync Stage 2N – Native Inbox-Übermittlung mit doppelter Freigabe

Stand 30.10.2026, isolierter **Draft** auf PR #178. **Keine** Änderung an produktiver oder installierter QA-App, keine Änderung in der Live-Supabase-Datenbank.

## Technisches Ergebnis

Die native Tauri-Methode `mesh_inbox_invite_send(targetDeviceId)` ist nur bei aktivem `katoos-auth-qa` und zusätzlich im Rust-Build gesetztem `KATOSYNC_MESH_INBOX_SEND_QA=1` freigeschaltet. Der Frontend-Knopf `Einladung senden (QA)` wird nur bei `VITE_MESH_INBOX_SEND_QA=1` und `VITE_KATOOS_AUTH_QA=1` angeboten. Der noch nicht ausgerollte Edge-Dienst Stage 2L hat ein **unabhängiges** `KATOSYNC_MESH_INBOX_STAGE=send-only`-Gate. Ohne die drei bewusst getrennten Freigaben kann kein Erfolg gemeldet werden.

Der native Versand verwendet **keine vom JavaScript angelieferte Einladung**: Jedes Mal wird aus dem bestehenden Keychain-Schlüssel eine frische, höchstens fünf Minuten gültige `MeshOffer` erstellt und zusätzlich die registrierte Quell- und Zielgeräte-ID mit Ed25519 signiert. Vorher wird die aktuelle KatoSync-Sitzung online geprüft und der kontogebundene Gerätestand gelesen. Bei widerrufener/fehlender Identität wird die Anfrage abgebrochen. Private Schlüssel, Zugangstoken und Service-Role-Credentials bleiben außerhalb des Frontend-IPC.

Das native HTTP-POST geht ausschließlich an den festen KatoSync/Supabase-Origin `/functions/v1/mesh-inbox-send`, mit kurzlebigem authentifiziertem User-Bearer und öffentlichem Client-API-Key; kein freies URL-Feld und kein direkter Schreibzugriff des Clients auf die Mesh-Tabellen.

## Quittung und Fehler

Nur HTTP **202 Accepted** mit begrenzter, vollständig validierter JSON-Quittung wird akzeptiert. Quittung muss `requestId`, exaktes `expiresAt`, `deliveryOnly=true`, `paired=false`, `transportReady=false` und `remoteJobsEnabled=false` enthalten. Falsche, überlange oder inhaltlich vertrauenssteigernde Antworten werden abgelehnt. Das Konto wird vor dem Erfolg erneut verifiziert. Nur fest definierte Fehlercodes für Anmeldung, nicht bereitgestellten Dienst, Abweisung, Replay oder Rate-Limit werden an die UI gegeben; keine Rohantworten, Tokens oder privaten Serverfehler.

Die UI zeigt nach einem positiven Beleg ausdrücklich **Einladung in der Queue, noch keine Peer-Freigabe und keine Fernrechte**. Das separate Vorbereiten in Stage 2M bleibt ein **schreibfreier Netzwerkpfad** und verschickt nichts. Ein Verbindungsstatus wird nicht geändert.

## Tests am M2 – Codeprüfung, kein Live-Transport

- **361 Node-Tests bestanden**, inklusive 4 neuer Stage-2N-Vertrags- und I18n-Tests.
- **227 Rust-Tests bestanden, 8 absichtlich ignoriert**; 2 neue Native-Inbox-Tests prüfen Erfolgsquittungen und verlässliche Fehlersignale.
- TypeScript-Check, Vite-Build und Rustfmt bestanden.
- QA-Komponenten für fehlende Poppler/Typst-Build-Ressourcen ausschließlich als `.test-only` temporär vorhanden und nach Prüfung entfernt.
- Keine Änderungen an installierter M2/M3-App, Keychain, Live-Mesh-Registry oder Edge-Deployment.

## Offene Abnahme vor realer Zustellung

1. Getrennte QA-Deployment-Prüfung der Stage-2L-Migration inkl. Backup und bestehender Service-Berechtigungen sowie Ausrollung der neuen Edge Function mit eingeschränktem `send-only`-Gate.
2. Positiver Versand von einem ausdrücklich autorisierten Gerät und Beleg in der realen `katosync.mesh_invites`-Tabelle, inklusive negativen Auth-/Revocation-/Replay-Tests. **Noch nicht durchgeführt.**
3. Stage 2O: Zielgeräte-attestierter Inbox-Lese-/Antwortkanal (Annehmen/Ablehnen) mit frischem Nonce und Einmalverwendung. Das ist nicht allein durch dieselbe Kontoanmeldung erlaubt.
4. Stage 2P: beidseitiger SAS-Vergleich, Schlüssel-Pinning und authentifizierter mTLS-Kanal. Erst danach darf `verbunden` angezeigt werden.
5. Writer- und Remote-Ausführungsberechtigungen bleiben eine unabhängige, spätere Freigabe.

Für M2/M3 bleibt der registrierte Status **discovered**, nicht trusted. Eine im Server als accepted markierte Einladung wäre ebenfalls noch keine Peer-Verbindung.
