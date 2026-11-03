# Stage 4C — Mesh-Paketgrenzen: Free 0, Pro 10

**3. November 2026 · Architektur-/Implementierungsentwurf, gestapelt auf Stage 4B**

## Tarifentscheidung (noch keine Live-Abrechnung)

- KatoSync Free: kein Cloud-Mesh, **0** Geräte. Kernfunktionen lokal dürfen unabhängig weiterlaufen.
- KatoSync Pro: **maximal 10 registrierte Geräte**. Preisziel 9,90 EUR/Monat, noch nicht im Stripe-/KATOOS-Zahlungskatalog angelegt.
- Externe LLM-Provider (z. B. ChatGPT/Anthropic) benötigen eigene Benutzerlizenzen; keine unbegrenzte bezahlte KI-Nutzung in 9,90 EUR.
- Geräteanzahl ist keine Garantie für 10 gleichzeitige Modell-Ausführungen; Ressourcensteuerung und P2P-Lastverteilung folgen separat.
- KATOOS und KatoSync sollen dieselbe Auth-Identität nutzen, **aber unterschiedliche Produktentitlements**. Die vorhandene KATOOS-Business-Subscription ist **kein Nachweis** eines separat verkauften KatoSync-Pro-Abos.

## Implementierter Kern (Edge + native UI, nicht deployed)

Die bereits existierende service-role-verwaltete \`katosync.mesh_owner_policy\` ist die serverseitige Geräteberechtigung. Es gibt keine gewöhnliche Benutzer-INSERT-/UPDATE-Policy.

- Fehlt eine explizite Policy-Zeile, ist das Ergebnis **Free, 0 Geräte**. Die bisherige ungesicherte 2-Geräte-Fallback-Regel wird aus der Edge-Funktion entfernt. Eine Anfrage auf neue Enrollment-Challenges gibt \`403 MESH_PRO_REQUIRED\`; eine bereits ausgestellte Challenge kann ebenfalls nicht zur Registrierung verwendet werden.
- Eine existierende, vom Server verantwortete Policy erlaubt 1–10 Geräte; Pro-Kunden erhalten nach Zahlungs-/Entitlementprüfung 10. Der Service begrenzt das Ergebnis und prüft den genauen Owner, max 2 Antwortzeilen, erlaubte JSON-Felder und Anfragezeit.
- Fehlerhafte oder nicht erreichbare Policy ist **503 fail-closed**, nie Free- oder Pro-Freigabe.
- Die native Stage3X-Folgeversion zeigt eine eigene Free/Pro-Meldung. Keine automatischen Upgrades, keine Kauf-Anmeldung und keine Schlüsselmanipulation.
- Die realen M2/M3 Stage3X-Geräte wurden vorher durch eine explizite Policy mit \`allowed_devices=10\` registriert; alte QA-Einträge wurden nach einer nur lokal gesicherten Archivierung entfernt.
- Die installierten Stage3X-Bundles wurden **nicht** verändert. Die Edge-Funktion wurde nach grüner CI gezielt auf Version 4 aktualisiert (siehe Live-Nachweis).

## Release-/Abrechnungsvoraussetzungen

1. Eigenständige KatoSync-Produktberechtigung verbindlich mit KATOOS/Stripe-Webhooks oder einem getrennten Rechnungskreis verbinden, nach erfolgreichem Bezahlstatus adminseitig Policy provisionieren. Downgrade/Fälligkeit darf vorhandene Geräte nicht weiterhin als vertrauenswürdig behandeln.
2. Paid-Entitlement in **allen** später deployten Inbox/Relay/Remote-Jobs durchsetzen, nicht nur bei neuen Registrierungen.
3. Vollständige Stub-Tests und Edge-Deployment-Abnahme, dann neue signierte/notarisierte Stage3X-Version; UI-Tests auf M2/M3.
4. Kein Admin-Schreibrecht oder Service-Role-Schlüssel in der nativen App; keine Remote-Pairing-Automatik allein durch einen Planwechsel.


## Live-Nachweis – begrenzter Produktions-Rollout vom 03.11.2026

- Nach dem ersten Push war die GitHub CI zunächst **rot**, da die synthetischen Challenge-Tests noch keinen expliziten Paid-Geräteeintrag bereitstellten. Die Fixtures wurden angepasst; die nächste CI auf `ddf6613` bestand in **Web Build, Windows Node Regression, Rust Format und Attribution**.
- Der bereits aktive Supabase-Edge-Function-Stand wurde vorher gegen die fünf Git-Quell-Dateien verglichen: alle fünf waren inhaltlich exakt gleich. Nach gezielter Erweiterung auf sechs Dateien wurde die bestehende Funktion `mesh-device-enrollment` im gemeinsamen Projekt `xbnnlyyxiilklsygxcof` auf **Version 4, ACTIVE, verify_jwt=true** gebracht. Deploy-Zeit laut Management-API: 03.11.2026.
- `device-entitlement.ts` und die aufrufenden Funktionen sind im erneut aus der Cloud gelesenen Deployment enthalten. Ohne explizite Policy `403 MESH_PRO_REQUIRED`; mit serverseitig verwalteter Policy max. 10 Geräte. Die vorhandene aktive Test-Policy bleibt `manual`, `passkey_enrollment_required=true`, `allowed_devices=10`.
- Positiver M3-Readback: erneuter `Geräte finden`-Lauf aus der signierten Stage3X-App erzeugte am 03.11. um **13:52:32 UTC** eine Enrollment-Challenge, die im gleichen Test **consumed** wurde; die Zahl registrierter Geräte blieb **2**. Damit sind keine überzähligen Einträge entstanden.
- Vorbereinigte Legacy-Geräte (beide von 28.10.) wurden **erst nach** zwei neuen Stage3X-Registrierungen, FK-/Trust-Referenzkontrollen und einem lokal mode-0600 gesicherten DB-Archiv entfernt; insgesamt 2 alte Einträge gelöscht. Die zwei heute neu registrierten Geräte bleiben `discovered` und **nicht paired**.
- Keine neue Stripe-Zahlung, kein bezahlter KatoSync-Pro-Tarif im Live-Billingkatalog, keine Deaktivierung von Sicherheitsprüfungen und keine neue Inbox/Relay-Funktion. Der PR bleibt **Draft** bis vollständige Mesh-/SAS-End-to-End-Prüfung und Billing-Entitlement-Wiring.
