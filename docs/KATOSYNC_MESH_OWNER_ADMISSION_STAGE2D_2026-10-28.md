# KatoSync Mesh – Stage 2D: account- und Keychain-gebundene TLS-Freigabe

Stand 28. Oktober 2026. **Draft, nicht für produktive Mesh-Sitzungen freigegeben.**

## Ausgangslage und konkretes Sicherheitsziel

Stage 2C verifiziert mTLS über echtes LAN, bislang mit ausschließlich
synthetischen Testschlüsseln und explizit bereitgestellten, lokal als
`ApprovedPeer` markierten Testobjekten. Diese sind **kein** gültiger
Sicherheitsnachweis für echte Geräte. Vor realen Verbindungen müssen der
kanonische Kontoinhaber online bestätigt und die lokale Peer-Freigabe
ausschließlich aus dessen OS-Schlüsselbund gelesen werden.

## Neue modulare Zuständigkeiten

- `mesh_identity::existing_identity(uid)`: liest **nur** einen bestehenden,
  kontogebundenen Ed25519-Schlüssel. Fehlt der Schlüssel, wird keine
  Identität automatisch beim Verbindungsversuch angelegt.
- `mesh_identity::ensure_identity(uid)`: die bisherige explizite
  Vorbereitung serialisiert nun die erste Schlüsselgenerierung innerhalb
  derselben Tauri-Prozessinstanz. Kein garantierter Cross-Process-Lock.
- `mesh_trust::approved_peer_for_account(uid, fingerprint, local_key)`:
  Keychain-Zugriff unter bestehendem Trust-Store-Mutex; geprüfte Liste,
  exakt formatierter Fingerprint, passender Ed25519-Key, Status
  `locally_approved`, glaubwürdiges Bestätigungsdatum, kein Self-Pairing,
  keine Duplikate oder zurückgezogenen Pins. Nie ein UI-supplied
  `ApprovedPeer` als Zulassung übernehmen.
- `mesh_admission`: eigener **nativer, nicht über IPC erreichbarer**
  Orchestrierungsservice. Er prüft das kanonische KATOOS-Konto online,
  lädt die eigene Identität und den genehmigten Peer aus dem Keychain,
  prüft Konto und Pin erneut, führt genau einen bereits bestehenden
  TLS-1.3-TCP-Probe aus und prüft Konto und Pin anschließend nochmals.
  Fehler sind feste Codes ohne Token-/Keychain-Leaks.
- `mesh_transport`: unverändertes, eng begrenztes Probe-Protokoll.
  UI und ViewModel bleiben unverändert, zeigen weiterhin
  `not_connected`, `verifiedPeers=0`, keine Remote-Aufträge.

## Sicherheitsgrenzen

- Admission ist ausschließlich für den expliziten `katoos-auth-qa`
  Build konfiguriert. Der reguläre Build antwortet
  `MESH_ADMISSION_NOT_CONFIGURED`.
- **Es gibt keinen Runtime-Caller, keinen Tauri-IPC-Befehl und keinen
  dauerhaften TCP-Listener.** Die Funktionen werden für die spätere
  gezielt freizugebende Sessionsteuerung vorbereitet. Erfolgreiche
  Kompilierung oder Tests bedeuten nicht, dass echte Geräte schon
  miteinander verbunden sind.
- Die Prüfung gilt nur für **einmalige** Probes. Eine dauerhafte
  Session müsste Widerrufe aktiv überwachen, bestehende Verbindungen
  bei Accountwechsel/Revoke sofort trennen und epoch-/leasebasierte
  Autorisierungen besitzen. Die dreifache Prüfung darf NICHT als
  hinreichender Schutz für langlebige Sessions verkauft werden.
- Online-Owner-Check und Keychain-Pin ersetzen **nicht** das noch
  fehlende geprüfte produktive Backend-Enrolment, das serverseitige
  Geräte-Eigentum, Passkey-Step-up, Replay-Schutz und Quotas belegt.

## Nachweise

- Synthetischer Key-/Fingerprint-Regressionstest:
  korrekter freigegebener Peer zulässig; fremder, gelöschter, eigener,
  ungültig formatierter, manipulierte und doppelte Pins abgelehnt;
  zu weit in der Zukunft liegende Freigaben abgelehnt.
- Bestehende native M2↔M3-Tests mit synthetischen Schlüsseln bleiben
  unabhängig und unverändert; keine echten Geräteschlüssel oder Nutzer-
  Konten werden für Testaufnahmen ausgelesen.
- QA-Rust-Suite, regulärer Cargo-Check und CI-Freigaben sind pro
  konkretem Commit einzeln zu dokumentieren.

## Roadmap ab hier

1. Authentifiziertes und explizit freigegebenes Geräte-Enrolment in
   isolierter KATOOS-QA, Owner-ID und Ed25519-Besitzprüfung.
2. Beide Geräte bestätigen einander **manuell** per signiertem
   Challenge/Response und gleichem SAS. Private Keys bleiben lokal.
3. Separater, einmaliger M2↔M3-mTLS-Test mit **echten** lokalen Pins
   und Keychain-Identitäten; Konto- und Revoke-Tests.
4. Aktive Mesh-Sessions mit abonnierter Revocation/Logout-, Sleep/Wake-
   und Heartbeat-Steuerung; keine Jobs vorher, Remote-Writes weiter zu.
