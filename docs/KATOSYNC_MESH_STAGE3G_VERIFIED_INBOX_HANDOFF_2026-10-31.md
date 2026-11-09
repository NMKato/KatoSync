# Stage 3G – Signierte Inbox-Einladung zur Challenge übergeben

Stand: 31.10.2026. Aufbauend auf Stage 3F (Draft PR #198). **Keine produktive Kopplung oder Cloud-Änderung.**

## Implementiert

Der native Inbox-Empfänger prüft eingehende Einladungen weiterhin strikt auf verifiziertes KATOOS-Konto, Zielgerät, gültigen Ablaufzeitpunkt, Ed25519-Offer-Signatur und separat signierte Dispatch-Bindung. **Erst danach** wird das bereits verifizierte öffentliche `signedOffer` im nativen `InboxItem` an die Oberfläche zurückgegeben. Private Schlüssel und der rohe Dispatch-Signaturstrang werden nicht weitergegeben.

Die React-Karte behält das öffentliche Offer nur nach einer **explizit angenommenen und erfolgreich quittierten** Einladung vor. Sie prüft Protokoll, feste öffentliche Feldformate und exakt gleiche Ablaufzeit. Erst der weitere Benutzerklick **„Sicherheitsnachweis vorbereiten“** ruft die vorhandene native `mesh_pairing_challenge_create` auf. Der Rust-Command prüft Signatur/Konto/Expiry erneut und erzeugt eine kurzlebige signierte Challenge. UI-Reaktionsgates verhindern doppelte Aufrufe und veraltete Ergebnisse. Die zurückgegebene Challenge muss zum unveränderten ursprünglichen signierten Offer passen.

Der öffentliche Challenge-Nachweis kann kopiert und auf dem einladenden Gerät in **Details → Antwort erstellen** verwendet werden. **Die automatische Rückzustellung über die Inbox fehlt noch.** Erst anschließend können der SAS-Abgleich und die gesonderte beidseitige Freigabe folgen. Keine stillschweigende Vertrauensspeicherung, kein TLS-Kanal und keine Fernaufträge.

## Test-Evidenz

- **456/456 Node** und **231/231 aktive Rust-Tests** (8 ignored) bestanden, TypeScript, Web-Build, Rustfmt bestanden.
- Neuer Rust-Test: authentischer synthetischer Sender plus separate Dispatch-Signatur; falsches Konto, anderes Gerät, abgelaufenes oder manipuliertes Offer, falsche Dispatch-Signatur und gefälschte `paired`-Angabe werden abgewiesen.
- Physischer M2: Headless-Chromium/Playwright durchläuft mit isolierten synthetischen Tauri-Antworten **Verbinden → Posteingang → Annehmen → Sicherheitsnachweis vorbereiten**. Vor dem letzten Klick kein Challenge-Aufruf. Zwei gleichzeitige Klicks ergeben **genau einen** Native-Aufruf. Der Browser zeigt nie fälschlich „Verbunden“. Log: `MESH_STAGE3G_CHROMIUM_HANDOFF_PASS`.
- QA-Weblistener und temporäre Browser-Dateien entfernt. Keine Live-Cloud-Aufrufe, keine Keychain-Testmutationen. Release-Sperre bleibt aktiv.

## Offene Produktgrenzen

Automatischer Challenge-/Response-Rückkanal, reale beidseitige SAS-/Keychain-Freigabe auf M2/M3, produktive Peer-Session, persistenter Widerruf und Cloud-Inbox-End-to-End sind nicht abgeschlossen. Vier neue Inbox-Migrationen und zwei Edge-Dienste bleiben nicht deployed. M3 war erreichbar, aber `/Volumes/DevSSD` nicht eingehängt. Keine eigenmächtige Freigabe von verschlüsselten Volumes. M2-Datenträger ist nahezu voll; für größere Builds zunächst Speicher prüfen.
