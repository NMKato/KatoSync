# KatoSync Mesh Stage 3N – Mandantengebundenes Ed25519-LIST-Proof v2

**01.11.2026 · NMKato Solutions · Gestapelter Draft auf Stage 3M · Nicht deployen**

## Problem

Das bisherige `katosync-mesh-pairing-relay-list-v1` signiert lediglich Protokoll, Owner, Device-ID, Nonce und Ablaufzeit. Da die Projekt-/Issuer-Adresse nicht zum signierten Material gehört, verbietet Stage 3M sämtliche v1-Relay-Reads auf isolierten QA-Mandanten.

## Neuer Testvertrag

Das zusätzliche **`katosync-mesh-pairing-relay-list-v2`** besitzt genau diese Felder:

`protocol`, `deviceId`, `origin`, `nonce`, `expiresAt`, `signature`.

Der Ed25519-Signaturtext wird in exakt dieser Reihenfolge aufgebaut:

`protocol|owner-user-id|origin|device-id|nonce|expiresAt`

Nur der genaue Supabase-Origin `https://<20-stellige-Projektreferenz>.supabase.co` darf als `origin` dienen. **Der im Token angegebene Origin muss exakt dem zuvor durch Stage 3M validierten tatsächlichen Relay-Origin entsprechen.** Signaturen werden bei jeder Abweichung, Mutation, Ablaufzeit, zusätzlichem Feld oder Protokoll-Downgrade abgelehnt.

- **Production:** v1 funktioniert nach wie vor für bisherige Aufrufe; zusätzlich wird das präziser signierte v2 validiert.
- **Preview:** ausschließlich v2 kann die WebCrypto-Read-Proof-Prüfung passieren; v1 bleibt blockiert. Der Endpoint setzt keine Trust-, TLS- oder Remote-Ausführungsrechte.
- **Native Rust:** ein **ausschließlich in `#[cfg(test)]` aktiver** v2-Signer erzeugt eine synthetische, ausschließlich öffentliche Fixture. Die produktive Tauri-Runtime erzeugt weiterhin v1 und ist nicht automatisch auf die QA-Cloud umgestellt.
- **Tests:** eigenständige JavaScript-Ed25519-/Edge-Handler-Proben (lokal ohne Cloud) und **nachgewiesene Rust→Edge-WebCrypto-Provenienz** mit ausschließlich öffentlicher Fixture. Die unveränderten Stage3J-v1-Fälle bleiben abgedeckt.

## Sicherheits- und Freigabegrenzen

Keine Supabase-GoTrue-Anmeldung, kein echter Supabase-Edge- oder PostgREST-HTTP-Roundtrip, keine KATOOS-Produktion- oder QA-Cloud-Mutation, kein realer Inbox-Invite, kein OS-Keychain-/SAS-/mTLS-Pairing, keine Gerätefreigabe. `paired=false`, `transportReady=false` und `remoteJobsEnabled=false` bleiben Pflicht.

Für eine **echte** isolierte Cloud-Prüfung müssen außerdem Inbox-Send/Receive, Device-Enrollment und der native Rust-Auth-/Signaturkontext denselben nachgewiesenen Issuer/Origin verwenden; der native LIST-v2-Pfad darf erst nach expliziter, verifizierter Auth-Mandantenbindung zugelassen werden. Die Stage3M-Origin-Freigabe bleibt ohne tatsächliches Cloud-Deployment ein reiner Quellcode-/Testnachweis.

## Nachweise und Ausführung

Normale CI-Tests:

    node --experimental-strip-types --test tests/meshRelayListV2Stage3N.test.ts
    node --experimental-strip-types --test tests/meshRelayRustListV2Stage3N.test.ts

Auf dem autorisierten M2 am 01.11.2026: fokussierter Rust-Fixture-Test **PASS**, anschließend **19/19** kombinierte Node/Edge-Regressionen einschließlich **2/2** Rust→Edge-v2-Nachweise **PASS**. Rustfmt, diff check und temporäre Ressourcenbereinigung sind geprüft.

Die Rust→Edge-Fixture wird ausschließlich mit einer autorisierten Testmaschine und temporären Build-Platzhaltern aus `qa_emit_stage3n_tenant_bound_list_v2_fixture` erzeugt. Die resultierende öffentliche Testdatei liegt in `tests/fixtures/meshRelayRustListV2Stage3N.public.json`. Keine privaten Seeds oder Token dürfen in die Fixture gelangen.

**Release bleibt gesperrt**, bis alle CI-Prüfungen, der tatsächliche native Rust-Test und eine unabhängig freigegebene isolierte Cloud- und Zwei-Mac-Abnahme erfolgreich sind.
