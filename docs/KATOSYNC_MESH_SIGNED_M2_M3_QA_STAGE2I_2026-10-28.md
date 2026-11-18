# KatoSync Mesh Stage 2I – signierter QA-App-Build M2/M3

Stand: 28.10.2026, spätabends. **Separater QA-Flavour**, keine Stable-App
geändert, keine automatischen Peer-Freigaben oder Remote-Jobs.

## Konfiguration und Build

Die QA-App verwendet zwingend:
- Bundle-ID `com.nmkato.katosync.meshqa` und Fenster
  `KatoSync · Mesh QA (isoliert)`;
- das Cargo-Feature `katoos-auth-qa` mit eigenem Keychain-Service
  `com.nmkato.katosync.katoos.auth.qa`;
- Frontend-Feature `VITE_KATOOS_AUTH_QA=1`;
- dieselbe gültige Developer-ID und unveränderte Entitlements der
  vorhandenen signierten QA-App.

QA-Build über `npm exec tauri -- build --debug --no-bundle
--config src-tauri/tauri.mesh-qa.conf.json --features katoos-auth-qa`.
Der Build-Flavour wird als separate JSON-Konfiguration versioniert,
damit die **eingebettete** Tauri-ID der äußeren App-ID entspricht.
`scripts/build-mesh-qa-macos.sh` reproduziert den Bau mit bewusst
nicht im Repo gespeichertem Signaturzertifikat; Base-QA-App und
Signaturidentität müssen über lokale, autorisierte Entwicklerumgebung
bereitgestellt werden.

## Auf realen Geräten erfolgreich durchgeführt

- M2 (Desktop-Commander, Mac): Tauri QA mit eigener Konfiguration neu
  kompiliert; signiertes Stage2I-App-Bundle gestartet, Fenster-Titel
  ausdrücklich korrekt. Alter QA-Build und die Stable-App bestehen fort.
- M3: identisches **signiertes** Stage2I-Bundle per kurzzeitigem
  LAN-Datentransfer vom M2 bereitgestellt. Nur die App selbst, **keine**
  Tokens oder Keychain-Daten. SHA-256 des Binary auf beiden Macs
  identisch: `4972235302bc9753ddec1ca7aa130b54ecd79fff73c596a2bf1ab9cce84f538f`.
  macOS-`codesign --verify --deep --strict` auf beiden erfolgreich;
  Team-ID `T8SB89JPX7`, unveränderte eigene QA-Bundle-ID.
- Stage2I-App auf beiden Macs gestartet; Signatur-/Prozess-Start
  bestätigt. Die alte QA-App wurde dabei **nicht** entfernt.
- Datenbank: Über live geprüftes, bestätigtes Supabase-Auth-Konto mit
  aktiver Sitzung **genau eine** `katosync.account_memberships`-Zeile
  `active` serverseitig freigeschaltet. Andere KATOOS-User
  ausdrücklich nicht übernommen. Keine KATOOS-CMS-Tabellen geändert.

## Reale Zwei-Geräte-Einschreibung am 28.10.2026: bestanden

Nachdem die **einzige** authentifizierte, bestätigte
Eigentümeridentität mit einer nicht abgelaufenen Sitzung
serverseitig in `katosync.account_memberships` auf `active`
gesetzt worden war, wurde in den signierten Stage2I-Apps auf
**beiden Macs** die sichtbare Aktion `Geräte finden` ausgeführt.
Der bestehende Tauri-Handler führte den online verifizierten
Auth-Flow, den Ed25519-Signaturbesitznachweis und den serverseitigen
Discovery-Write aus. **Keine manuell eingefügte Geräte-Testzeile.**

Die Live-DB-Abnahme ergab:
- **1** aktives KatoSync-Mitglied, **2** Geräte, **2** unterschiedliche
  Signing-Keys und **2** unterschiedliche Fingerprints, gleicher
  `owner_user_id`, beide `membership_state=discovered`;
- **3** Challenge-Datensätze nach den UI-Testläufen,
  davon **3 atomar verbraucht** (keine offene aktive Challenge);
- **0** Mesh-Invites. Keine widerrufenen Geräte. Keine
  Peer-Freigabe, kein mTLS und keine Remote-Schreibrechte.
- Auf M2/M3 sind die **alten** QA-Prozesse anschließend über
  den normalen App-Beenden-Befehl geschlossen worden; die neuen
  Stage2I-Prozesse blieben in Betrieb. Die Stable-App blieb
  unverändert.

Das ist ein belegter **E2E-Registrierungserfolg** bis zur
Geräte-Registry, nicht automatisch eine Peer-Verbindung.

## Noch ausstehend, nicht als Erfolg ausgeben

- Die zwei unabhängigen SAS-Codeanzeigen auf M2 und M3 **vom
  Menschen vergleichen und auf beiden Seiten bestätigen**.
  Kein Agent darf eine fehlende visuelle Bestätigung ersetzen.
- Echte pinned mTLS-LAN-Negativ- und Positivtests an den installierten
  neuen QA-Apps; bis dahin kein produktiver Mesh-Betrieb.
- Frühere Stacked-Draft-PRs noch nicht gemerged. QA-App wird
  isoliert getestet, Stable-Installationen bleiben unverändert.

Hinweis: Ein separates Postgres-Schema trennt KatoSync-Daten und Rechte,
nutzt aber weiterhin den vorhandenen Supabase-Auth-Issuer.
