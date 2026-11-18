# KatoSync Mesh Stage 3L – Signierte synthetische JWTs über echten Loopback-HTTP-Weg

**1. November 2026 · NMKato Solutions · DRAFT/QA – nicht deployen**

## Ziel und tatsächlicher Fortschritt

Stage 3K verband native Rust-Ed25519-Signaturen, den unveränderten QA-Edge-Handler und echte kurzlebige PostgreSQL-17-Transaktionen. Die Authentifizierung und die PostgREST-HTTP-Übertragung waren jedoch ausschließlich direkte, programmatische Mocks.

**Stage 3L ergänzt echte HTTP-Kommunikation über einen ausschließlich auf 127.0.0.1 gebundenen Server sowie die kryptografische Verifikation eines synthetischen HMAC-SHA256-JWT.**

- Der ausschließlich für QA implementierte lokale Auth-Endpoint akzeptiert nur ein korrekt signiertes, nicht abgelaufenes JWT mit synthetischem Issuer, passender Audience, Rolle und Session-ID. Der Signaturschlüssel wird für jeden Testlauf zufällig erzeugt und nie persistiert.
- Der lokale REST-HTTP-Adapter erzwingt explizite Service-Rolle, zugelassene Pfade und Methoden und reicht den Inhalt dann an den Stage-3K-Adapter mit echter PostgreSQL-17-Datenbank weiter.
- Der unveränderte Edge-Handler prüft zusätzlich die echten, frisch in Rust erzeugten Ed25519-Signaturen für Challenge B→A, Response A→B und die beiden signierten Abrufe.
- Negative Prüfungen: manipuliertes und abgelaufenes JWT, fremder JWT-Account, fehlende Service-Rolle, unerwartete Route, Response ohne Challenge, mehrfacher signierter Abruf, manipulierte Nachrichtensignatur und Widerruf des Geräts im echten temporären SQL-Datensatz.
- Nach sämtlichen Prüfungen bleiben paired=false, transportReady=false, remoteJobsEnabled=false. Kein persistenter Geräteschlüssel, keine tatsächliche Freigabe und keine Remote-Ausführung.

**Tatsächlicher M2-Test:** `STAGE3L_SIGNED_JWT_LOOPBACK_EDGE_POSTGRES_PASS`, Exit 0. Die separat für CI geeigneten zwei JWT-/HTTP-Gateway-Tests sind ebenfalls grün. Stage 3K bleibt im normalen Modus ohne Änderungen am Ablauf.

## Reproduktion

Auf dem autorisierten M2 mit bereits vorhandenem Cargo-Target und lokalem PostgreSQL 17:

    KATOSYNC_STAGE3L_LOOPBACK=SIGNED_LOCAL_ONLY \
      CARGO_TARGET_DIR=/Pfad/zum/bestehenden/target \
      node scripts/qa-mesh-rust-postgres-stage3k.mjs

Alternativ unveränderte Stage 3K:

    CARGO_TARGET_DIR=/Pfad/zum/bestehenden/target \
      node scripts/qa-mesh-rust-postgres-stage3k.mjs

Die Tauri-Testressourcen werden lediglich temporär erzeugt und wieder entfernt. Rust verwendet offline-Cargo, Test-Seeds und frische synthetische Signaturzeitpunkte. PostgreSQL läuft über einen privaten Unix-Socket ohne TCP. Der JWT-/HTTP-Adapter akzeptiert nur die festgelegte synthetische logische Herkunft und leitet Netzwerkzugriffe ausschließlich an 127.0.0.1 weiter.

## Live-Bestandsaufnahme (read-only über verbundenes Supabase, 01.11.2026)

- Gemeinsames KATOOS-Projekt aktiv/gesund; 1 Branch (`main`), kein isolierter QA-Branch.
- Nur die 3 KatoSync-Mesh-Basismigrationen sind vorhanden; **0/5** vorgesehene Inbox-/Relay-Migrationen deployed.
- Edge: `mesh-device-enrollment` aktiv; **keine** `mesh-inbox-send`, `mesh-inbox-receive` oder `mesh-pairing-relay`-Deployments.
- 2 erkannte Geräte, **0 trusted**, 0 Einladungen.
- Auf dem gemeinsamen Projekt sind `pg_cron` und `pg_net` installiert, und ein Cron-Job ist aktiv. Derzeit hat die Rolle `authenticated` SELECT auf `katosync.mesh_invites`; die noch nicht ausgerollte Receive-Migration ändert den Zugriff. Dieser Istzustand darf nicht als fertige Inbox-Sicherheitsfreigabe missverstanden werden.

## Bewusste Grenzen

**Dies ist keine echte Supabase-JWT-Verifikation, kein GoTrue- oder Supabase-Edge-Gateway-Test und keine echte PostgREST-HTTP-Installation.** Der JWT-Issuer und die Service-Rolle sind ausschließlich synthetisch; die HTTP-Strecke ist ein eigens gebundener lokaler QA-Adapter. Ein gültiger Test-JWT darf niemals mit einer echten KATOOS-Sitzung verwechselt werden. Die lokale SQL-vorbereitete Einladung ist keine echte Nutzerzustimmung.

Die nächste Stufe benötigt einen unabhängig freigegebenen, preislich und hinsichtlich Restore/Jobs isolierten QA-Cloud-Betrieb. Vorher **keine** produktiven SQL-/Edge-Änderungen, keine kostenpflichtigen Branches, keine App-Freigabe oder reale M2↔M3-Keychain/SAS/mTLS-Kopplung. Die unabhängigen Beta-Blocker #125 und #130 bleiben offen.
