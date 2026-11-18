# KatoSync Stage 2M – Native zielgebundene Geräte-Einladung

Stand 29.10.2026. Stacked Draft auf PR #177, keine App-Installation oder Live-Migration.

## Ziel

Der Bediener kann in der KatoSync-Mesh-Geräteliste gezielt **Einladung vorbereiten** wählen. Die Vorbereitung erfolgt im nativen Tauri-Rust-Prozess, ausschließlich nach persönlichem Klick. Die bestehende Ed25519-Identität wird aus dem macOS-Keychain gelesen. Es wird **niemals** stillschweigend ein neuer Geräteschlüssel erzeugt.

## Sicherheitsvertrag

- Feature-Gate `katoos-auth-qa`; ohne Gate `MESH_INBOX_NOT_CONFIGURED`.
- Die authentifizierte KatoSync-Benutzer-ID ist der Owner. Das Ziel ist ausschließlich eine syntaktisch gültige UUID, keine vom Frontend behauptete Owner-ID.
- Die native Funktion liest die Geräte-Registry serverseitig mittels bereits gültiger Session und `Accept-Profile: katosync`, nur bekannte Felder, maximal 10 Geräte und begrenzte Antwortgröße. Die Registry muss den aktuellen Geräte-Public-Key aus dem Keychain als registrierte eigene Identität enthalten. Der Ziel-Datensatz gehört demselben Owner, ist nicht widerrufen und weiterhin `discovered`.
- Quelle und Ziel dürfen nicht identisch sein; doppelte Geräte-IDs, fremde Owner oder unregistrierte Schlüssel führen zu Fail-Closed.
- Unmittelbar vor Erzeugung der Einladung wird die authentifizierte Identität erneut bestätigt. Die vorhandene native Signierlogik erstellt eine fünf Minuten gültige `MeshOffer` und speichert ihren Pending-Digest im bestehenden Schlüsselbundmechanismus.
- Zusätzlich signiert derselbe **private Ed25519-Geräteschlüssel**, ohne ihn an das Frontend weiterzureichen, die exakte serverseitige Stage-2L-Bindung:
  `katosync-mesh-inbox-send-v1|accountScope|sourceDeviceId|targetDeviceId|offerNonce|offerExpiresAt`.
- Das UI zeigt ausschließlich eine **vorbereitete, noch nicht gesendete** Einladung an. Keine Inbox-Schreiboperation, keine Zustellung, keine Gerätefreigabe, kein mTLS oder Remote-Job wird ausgelöst.
- Die vorhandene manuelle Stage-1B/Stage-1C-SAS-/Widerrufslogik bleibt isoliert.

## Belege

- **225/225 aktive Rust-Tests bestanden, 8 bewusst ignoriert**, darunter 3 neue native Mesh-Inbox-Tests (registrierter Owner, Widerruf, Zielbindung mit kryptografischem Signaturtest).
- **357/357 Node-Tests**, TypeScript-Typecheck, Vite-QA-Build und Rustfmt bestanden, einschließlich 4 neuer Vertrags-/i18n-Prüfungen.
- Bestehender Code und Stage-2L-Backend-Tests vollständig unverändert. Kein Cloud-Rollout.
- Für lokale Tauri-Compilerläufe wurden ausschließlich `.test-only`-QA-Platzhalter verwendet. Der echte `release:check` hat erwartungsgemäß mit `RELEASE_LOCK_MISSING` blockiert. Diese Platzhalter werden nach den Tests entfernt.

## Danach

1. Native signierte Vorlage an `mesh-inbox-send` übergeben, ausschließlich nach Explizitaktion und Feature-Gate. Für Livebetrieb fehlen Migration, gesonderte Testfreigabe und Edge-Deployment.
2. Zielgerät-gerechte signierte Inbox-Reads, Annehmen/Ablehnen, serverseitige Single-use-Entscheidungen und TTL.
3. Bewusster beidseitiger SAS-Vergleich, persistente Ed25519-Key-Pins, reales TLS 1.3 auf M2/M3, Widerruf und Wiederverbindung.
4. Erst dann Anzeige „verbunden“ und gesonderte Read-only-Auftragsfreigabe. Keine schreibenden Agentenjobs ohne getrennte Autorisierung.

**Freigabegrenze:** Stage 2M belegt die lokale signierte Vorbereitung, keine tatsächliche Geräteverbindung.
