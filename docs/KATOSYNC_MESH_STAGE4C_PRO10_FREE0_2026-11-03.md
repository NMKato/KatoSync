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
- Die aktiven Stage3X-Bundles und die produktive Edge-Funktion wurden hier **nicht** aktualisiert.

## Release-/Abrechnungsvoraussetzungen

1. Eigenständige KatoSync-Produktberechtigung verbindlich mit KATOOS/Stripe-Webhooks oder einem getrennten Rechnungskreis verbinden, nach erfolgreichem Bezahlstatus adminseitig Policy provisionieren. Downgrade/Fälligkeit darf vorhandene Geräte nicht weiterhin als vertrauenswürdig behandeln.
2. Paid-Entitlement in **allen** später deployten Inbox/Relay/Remote-Jobs durchsetzen, nicht nur bei neuen Registrierungen.
3. Vollständige Stub-Tests und Edge-Deployment-Abnahme, dann neue signierte/notarisierte Stage3X-Version; UI-Tests auf M2/M3.
4. Kein Admin-Schreibrecht oder Service-Role-Schlüssel in der nativen App; keine Remote-Pairing-Automatik allein durch einen Planwechsel.
