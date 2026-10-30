# KatoSync – Stage 3D: signierter SAS-Nachweis → beidseitige Freigabe → nativer TLS-Transport

**Stand: 30.10.2026** · Aufbauend auf [Stage 3C, Draft-PR #195](https://github.com/NMKato/KatoSync/pull/195). **Kein Live-Enrollment, kein Cloud-Deployment und kein produktiver Schlüsselbundzugriff.**

## Warum dieser Test erforderlich war

Stage 3C bewies auf zwei echten Macs den gegenseitig geprüften TLS-1.3-Transport mit synthetischen Ed25519-Identitäten. Die getrennten Rust-Komponenten für den signierten Einladungshandschlag (`mesh_identity`, `mesh_handshake`), die lokale menschliche Freigabe (`mesh_trust`) und den Transport (`mesh_tls`, `mesh_transport`) waren zwar bereits jeweils getestet, aber **noch nicht als eine zusammenhängende native Sicherheitskette** ausgeführt worden.

Stage 3D fügt genau eine solche **hermetische, automatisierte Rust-Integration** hinzu und lässt die eigentliche Produktivarchitektur bewusst unangetastet.

## Ausführbarer Sicherheitsnachweis

```bash
cargo test --offline --manifest-path src-tauri/Cargo.toml \
  --features katoos-auth-qa --lib \
  mesh_handshake::tests::synthetic_signed_sas_to_explicit_two_sided_pin_and_real_mtls_is_fail_closed \
  -- --exact --nocapture
```

Dazu sind wie üblich die bereits für `cargo test` erforderlichen lokalen Tauri-Build- und Platzhalterressourcen nötig.

Der Test nutzt **dieselben produktiven Rust-Funktionen**, jedoch ausschließlich die im Test erzeugten Ed25519-Seeds, eine fiktive Besitzer-ID und zwei **rein lokale, im Speicher gehaltene Freigabelisten**. Über `#[cfg(test)]` stehen zwei schmale Helfer zur Verfügung, die direkt die echten Produktionsprädikate `confirm_pending` und `select_approved_peer` aufrufen. Diese Helfer existieren nicht im Release-Binary und besitzen keinerlei Betriebssystem-, Tauri-, Netzwerk- oder Cloud-Zugriff.

Die Integration prüft, in dieser Reihenfolge:

1. **Signiertes Offer** des Geräts A erzeugen; Gegenstelle B signiert die Challenge; Gerät A signiert die Antwort. Alle Signaturen und der **exakte Account-Scope** werden auf beiden Seiten unabhängig geprüft. Ein anderer Besitzer wird abgewiesen.
2. **Identischer SAS-Code** aus demselben signierten Challenge-Transkript auf A und B. Erfolgreiche kryptografische Besitznachweise setzen `paired=false` und `transportReady=false`, nicht automatisch „verbunden“.
3. **Ohne SAS-Bestätigung gibt es keinen zulässigen Peer.** Falscher, nicht übereinstimmender SAS wird abgewiesen. Ein Ablauf nach dem ursprünglichen signierten `challenge.expires_at` darf nicht durch ein neues Bestätigungsfenster verlängert werden.
4. **Beidseitige, explizite lokale Bestätigung:** A kann B zulassen, damit wird A aber **nicht automatisch auf B zugelassen**. Erst eine gesonderte Bestätigung auf B erzeugt die zweite lokale Zulassung. Fremde Schlüssel und die eigene Identität sind nicht zulässig.
5. **Tatsächlicher TLS-1.3-mTLS-Transport** über einen vom Betriebssystem vergebenen privaten `127.0.0.1`-TCP-Port, beidseitig mit den **aus demselben Ed25519-Seed abgeleiteten Zertifikaten** und den soeben erzeugten zulässigen Peer-Pins. Frisches Hello/Nonce-Echo muss auf beiden Seiten erfolgreich sein.
6. **Widerruf:** Die simulierte lokale Freigabe auf A wird gelöscht; eine anschließende Zulassungsprüfung mit denselben Schlüsseln wird verweigert, obwohl der einmalige vorherige mTLS-Transport erfolgreich war. Übergreifende `verifiedPeers=0`, `remoteReadOnlyDispatch=false` und `crossDeviceWrites=false` bleiben unverändert.

Vier neue plattformübergreifende Node-Contracttests sichern die kritischen Quellen-/Feature-Grenzen in GitHub Actions gegen Rückschritte. Alle zusätzlichen Rust-Helfer sind **nur unter `#[cfg(test)]`** verfügbar.

## Verbleibende Systemgrenzen

**Belegt:** Die Produktionsprotokollfunktionen für signierte Besitzer-gebundene Besitznachweise, exakten SAS, **beidseitige** explizite lokale Freigabe, Pin-Auswahl, nativen TLS-Transport und Widerruf lassen sich als eine Kette mit synthetischen Identitäten ausführen. Stage 3C belegt zusätzlich den realen nativen Transport auf **zwei physischen Macs**.

**Nicht belegt:** Hier wurde **kein** echter macOS-Keychain gelesen oder beschrieben, kein richtiger Benutzer-KATOOS-Login abgeschlossen, keine echte Eingabe des SAS auf beiden Benutzeroberflächen vorgenommen und keine echte `locally_approved`-Freigabe dauerhaft gespeichert. Auch echte serverseitige Enrollment-Antworten, Cloud-JWT/PostgREST/Edge-Integration, 24/7-Peer-Session, bidirektionaler Widerruf und Remote-Aufträge bleiben NO-GO.

Die bestehenden produktiven `mesh_admission`-Gates – überprüfte KATOOS-Sitzung, `existing_identity` **ohne** automatische Neuerzeugung, exakte Keychain-Freigabe, zwei gültige Enrollment-Geräte, erneuter Konto-/Schlüssel-/Freigabecheck nach der Transportprobe – wurden **nicht gelockert**.

**Nächster praktischer Schritt:** Auf einer getrennt freigegebenen, ausdrücklich geeigneten QA-Umgebung den vollständigen App-UI-Flow mit zwei Geräten unter demselben ausdrücklich freigegebenen KATOOS-Testkonto und expliziter Bestätigung des Bedieners prüfen. Der echte Keychain-Test erfordert eine bewusste Freigabe, da er langlebige lokale Identitäten oder Peer-Pins erzeugen kann. Eine getrennte kostenpflichtige Supabase-QA-Umgebung bleibt zusätzlich genehmigungspflichtig.
