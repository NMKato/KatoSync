# Stage 3E – Mesh-Karte: Gerät auswählen, gesondert einladen, Status korrekt anzeigen

**31.10.2026** · Auf [Stage3D, Draft-PR #196](https://github.com/NMKato/KatoSync/pull/196) aufbauend. Schwerpunkt ist die **tatsächliche React/Tauri-Bedienführung**, nicht die Einführung eines neuen Pairing-Protokolls.

## Implementierte und überprüfte Produktänderung

**Vorher:** Der primäre Button „Verbinden“ rief `prepareAndInvite()` auf und erzeugte ausschließlich eine signierte öffentliche JSON-Einladung ohne konkretes Zielgerät. Die Geräteauswahl, die QA-Sendeschaltfläche und der Einladungs-Posteingang waren nur innerhalb des ausgeklappten technischen Bereichs sichtbar. Benutzer konnten dies fälschlich als Start einer tatsächlichen Geräteverbindung verstehen.

**Jetzt:** Der primäre Button **„Verbinden“** öffnet eine kompakte geführte Geräte-Karte und liest zunächst ausschließlich das **bereits vorhandene** Konto-Geräteverzeichnis mit dem registrierten nativen Befehl `mesh_account_devices_list`. Dieser Aufruf **registriert kein Gerät, erzeugt keinen Keychain-Schlüssel und versendet keine Einladung**. „Geräte finden“ ist weiterhin eine ausdrücklich getrennte Aktion und verwendet erst nach dem Klick `mesh_account_device_discover` – die bestehende, konto-verifizierte Signatur-/Registrierungsprozedur, die die lokale Identität bei Bedarf im OS-Keychain erzeugen **kann**. Deshalb bleibt dieser Seiteneffekt an den eigenen Nutzerklick gebunden.

Die neue geführte Ansicht ist **oberhalb** der technischen Details sichtbar, bietet eine auswählbare Liste der Geräte mit Plattform, Registry-Zustand und **Zeitpunkt der letzten Meldung**, jedoch **keinen unbewiesenen Online-/Verbunden-Status**. Die Auswahl allein erzeugt keine Freigabe.

Je nach den vorhandenen doppelten QA-Freigabeschaltern stehen bei einem ausgewählten, serverseitig als `discovered` bestätigten Zielgerät ausschließlich die bestehenden nativen Aktionen zur Verfügung:

- **QA-Senden aktiv:** sichtbare explizite Schaltfläche `mesh_inbox_invite_send` erst nach individueller Gerätewahl, mit sämtlichen vorhandenen Rust-/Cloud-Gates; danach lautet der belegte Zustand **Einladung abgelegt**, nicht „gekoppelt“.
- **Nur Auth-QA aktiv:** `mesh_inbox_invite_prepare` erzeugt auf separaten Klick lediglich ein signiertes Draft, wird **nicht** versendet und erzeugt keine Verbindung.
- **Keine passende Freigabe oder kein geeignetes Ziel:** Anzeige eines verständlichen gesperrten Zustands; kein Versuch eines unsicheren Fallbacks.

Der Posteingang mit **Annehmen / Ablehnen** ist nun ebenfalls im geführten Bereich, **nur** bei beiden QA-Flags sichtbar und wird **erst auf expliziten Nutzerklick** per `mesh_inbox_recipient_list` abgefragt. Eine Entscheidung `mesh_inbox_recipient_decide` bedeutet weiterhin **nicht** gekoppelt. Der Nutzer wird deutlich darauf hingewiesen, dass SAS-Bestätigung und native Verbindung fehlen.

Die bestehenden manuellen signierten Einladungen (Offer→Challenge→Response), verifizierte Kontositzung, SAS-Eingabe und lokale Peer-Widerruf-Funktion sind unter **Details** erhalten. „Verbinden“ löst diese sicherheitskritischen Aktionen nicht implizit aus.

## UI-/Sicherheitsqualität

- Gerätewahl mit `aria-pressed`, Tastatur-Fokusindikator und klaren Zustandslabels, responsiv bis 420px.
- Light-/Dark-Mode: `var(--surface)`, `var(--surface-raised)`, `var(--text)`, `var(--text-muted)`, `var(--line)` statt fixer dunkler Hintergründe in den neu gestalteten Elementen.
- Deutsche, englische, spanische und russische Texte, einschließlich ausdrücklicher Hinweise „noch nicht gekoppelt“ / „Versand nicht freigeschaltet“.
- Konto-/Refresh-Wechsel verwirft veraltete lokale Geräteauswahl und Registry-Zwischenstände.
- Kein neues Netzwerk-API, kein zusätzlicher Listener, keine Autopairing-Abkürzung, keine Remote-Jobs und keine geänderten Produktionsberechtigungen.

## Tatsächlich durchgeführte QA

1. **448/448 Node-Regressionstests bestanden**, einschließlich fünf neuer Stage3E-Sicherheitskontrakte und aktualisierter Tests für die jetzt getrennten Aktionen „Verbinden“ / „Geräte finden“.
2. **TypeScript und produktiver Web-Build bestanden** auf physischem M3.
3. **Echter Chromium-/Playwright-Browser-Test** mit temporärem Vite-Testharness auf `127.0.0.1:4178` und ausschließlich lokal gemockter `window.__TAURI_INTERNALS__.invoke`-Schnittstelle. Positiv geprüft: Klick auf „Verbinden“ ruft nur `mesh_account_devices_list`, **nicht** `mesh_account_device_discover` oder `mesh_inbox_invite_send`; Auswahl des M3 erzeugt **keinen** Send; expliziter Klick auf „Einladung senden (QA)“ genau einen nativen Send-Befehl; „Posteingang prüfen“ ruft `mesh_inbox_recipient_list`; „Annehmen“ ruft `mesh_inbox_recipient_decide`; während des gesamten Flows erscheint kein unwahrer Connected-Status. Ergebnis: `MESH_STAGE3E_REAL_BROWSER_QA_PASS`. **Der Browser-Harness hat keine echte Cloud-Anfrage ausgelöst.**
4. M2-Native-Rust-Kryptografie, TLS1.3-Freigabe, PostgreSQL-Restore und Deno-Laufzeit bleiben durch die bisherigen Stages 3A–3D abgedeckt; Stage 3E verändert nur die UI, Styles, Übersetzungen und plattformneutrale Node-Tests.

## Noch gesperrt

Die realen Inbox-Edge-Funktionen und vier vorbereiteten SQL-Migrationen wurden auf dem gemeinsamen KATOOS-Supabase-Projekt **nicht** deployed. Die auf beiden Macs installierte App ist durch diese PR **noch nicht aktualisiert**. Der echte KATOOS-Login/Keychain-SAS-Dialog mit Benutzerbestätigung auf beiden Macs bleibt ein eigener operator-freizugebender Hardwaretest; eine geschlossene mTLS-Session mit echten Freigaben und Remote-Jobs existiert nicht.

Eine isolierte kostenpflichtige Cloud-QA-Umgebung erfordert separate Budget-/Betreiberfreigabe. **Kein Merge, kein Release, keine automatische Kopplung.**
