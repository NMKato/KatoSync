# KatoSync Stage 3.5f — überprüfbare lokale SAS-Freigabe aus dem Relay

Datum: 04.11.2026. Isolierter Entwicklungszweig `fix/mesh-v35f-relay-approval-20261104`, auf Stage35d aufgebaut, damit der parallel bearbeitete Stage35e-Zweig unverändert bleibt.

## Befund aus zwei echten Macs

Die notarisierten Stage35e-Test-Apps laufen auf M2 (KAI Nexus) und M3 (KAI Nika). Das gemeinsame, autorisierte KATOOS-Konto besitzt zwei angenommene Mesh-Einladungen und ein signiertes Challenge/Response-Paar im QA-Relay. Die Live-Registry meldet unverändert **0 trusted**. Die vorhandene Stage35e-Oberfläche zeigt zwar nach `mesh_pairing_response_create` bzw. `mesh_pairing_response_verify` den SAS-Code, bietet aber die explizite lokale Freigabe in der alten technischen Kopplungssektion nur bei `pairingProof`/`pairingVerified` an — **nicht bei `relayProof`**.

## Änderung

- Die normale Relay-Ansicht zeigt nach erfolgreicher nativer Signaturprüfung einen lesbaren, kontrastreichen SAS-Code und unmittelbar darunter die bewusste Freigabe nach manuellem Vergleich mit dem anderen Mac.
- Die Freigabetaste wird ausschließlich bei **genau ausgewähltem Peer mit übereinstimmendem Fingerprint**, gültigem, manuell eingegebenem 14-stelligem SAS, nicht widerrufenem Peer und ohne laufenden Schreibvorgang aktiv.
- Die Taste ruft nur den vorhandenen nativen Command `mesh_local_approve_peer` auf. Der bewährte Rust-Keychain-Pending-Record erzwingt nochmals dieselbe SAS-Zeichenfolge, Frist von maximal fünf Minuten, keine Selbstkopplung und Einmalverbrauch. Keine automatische Freigabe und keine Übertragung privater Schlüssel.
- Nach erfolgreicher Freigabe verschwinden Code und Eingabe; bei einem Wechsel der Identität/Kontositzung werden alte Eingaben zurückgesetzt.
- Selbst der lokal gespeicherte öffentliche Peer-Key bedeutet **keinen mTLS-Transport und keine Remote-Job-Erlaubnis**.
- Bedienhinweise sind für Deutsch, Englisch, Spanisch und Russisch ergänzt. Keine Änderungen an Registrierung, Stripe, Picnic, KatoOS oder den produktiven Server-Funktionen.

## Prüfungen

6 gezielte Tests bestehen: korrekter Zielschlüssel, falscher Zielschlüssel, falscher bzw. fehlender SAS, Revoke/Trust/Busy-Zustände, expliziter UI-Klick und Sprachhinweise. TypeScript/Vite-Build erfolgreich. Gesamte Node-Regression des eigenständigen Stage35d-Basiscodes: **659/659 erfolgreich**.

## Release-Abhängigkeit

Diese Änderung ist **noch nicht in die auf M2/M3 installierten notarisierten Stage35e-Apps übernommen**. Zuerst den Stage35e-Code committen und dann den isolierten Stage35f-Commit darauf integrieren; anschließend Build, Apple Developer ID und notarisiertes Update auf beiden Macs. Erst nach einem frischen beidseitigen Challenge/Response und einem vom Kontoinhaber auf beiden Geräten verglichenen SAS darf der öffentliche Peer-Key separat bestätigt werden.

**Keine automatische Trust-Freigabe**, auch wenn beide Macs dasselbe KATOOS-Konto verwenden. Separat nachweisen: beidseitiger lokaler Public-Key-Pin, gegebenenfalls Cloud-Trust-Reconciliation, spätere mTLS-Direktverbindung und ein wirklich quittierter Remote-Job. Ein `discovered`/Heartbeat-/Relay-Status allein ist kein Erfolg von Mesh 3.5.
