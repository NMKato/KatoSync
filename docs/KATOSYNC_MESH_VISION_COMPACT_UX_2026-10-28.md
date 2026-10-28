# KatoSync Vision – schlanke Mesh-Bedienung (28.10.2026)

## Nutzerwunsch
Die Vision-Systemkarte soll wieder das Zentrum sein. Über der Karte soll kein langer Stack aus Auth-Formularen, Geräte-Roster, Stufe-0-Chips, Pairing-Textareas und SAS-Nachweisen stehen.

## Implementiert
- Kompakte „KatoSync Mesh“-Leiste unmittelbar über der Vision-Karte.
- Zustand bewusst wahrheitsgemäß: „Nicht verbunden“ / „Keine Geräte verbunden“, kein erfundenes „Online/Verbunden“-Label.
- Drei unmittelbare Aktionen: „Geräte finden“, „Verbinden“, „Details“.
- „Details“ ist **standardmäßig geschlossen** und enthält die bisherigen technischen Informationen, die KATOOS-QA-Wiederanmeldung, den Geräte-Roster, die signierten Einladungen, die SAS-Prüfung und lokale Widerrufe.
- „Geräte finden“ führt weiterhin die bereits implementierte native **READ-ONLY** Kontoabfrage durch. Fehlt die noch nicht veröffentlichte Supabase-Migration, wird eine eindeutige Erklärung statt einer leeren Liste gezeigt.
- „Verbinden“ bereitet aktuell ausschließlich eine signierte 5-Minuten-Einladung vor. Es behauptet niemals eine echte Kopplung. Ergebnis, Fehler und sichere Kopieraktion sind direkt in der kompakten Leiste sichtbar; die technischen Rohdaten bleiben in „Details“.
- Qualitäts-/Daueranzeige bleibt in „Details“ ausdrücklich **ohne Verbindung**. Echte Latenz, Uptime und „Trennen“ werden erst nach existierendem kryptografisch bestätigtem Peer-Transport eingeführt. Keine falschen Metriken und kein funktionsloser Trennen-Button.
- responsive Layout, Tastaturbedienung (aria-expanded/aria-controls), lokalisierte Texte DE/EN/ES/RU.

## Qualitätsnachweis
- 277/277 Frontend-Tests (davon vier neue UX-/Sicherheits-Regressionstests).
- TypeScript-Typecheck und Vite Production Build.
- Native Rust und Signed macOS QA Build zur kontrollierten Anzeigeprüfung; keine Rust-Domänenänderung.
- Dieser UI-PR ist ein Draft, gestapelt auf PR #157. Kein Supabase-Produktiv-Rollout, kein automatisches Pairing, keine neue Berechtigung und kein Remote-Writer.

## Nächste technische Freigabe-Gates
1. Echte autorisierte Online-Geräteliste: RLS/Schema #155 kontrolliert in QA-Projekt deployen, signed server enrollment mit Bound-Key-Proof.
2. Einladungseingang und geräteübergreifende Zustellung statt manuellem Textaustausch.
3. Beidseitig verifiziertes Peer-Transport/mTLS. Erst danach Anzeige „Verbunden seit…“, Qualität aus gemessener RTT und echte Aktion „Verbindung trennen“.
4. Hardware-QA M2/M3 mit sauberer Signatur und wiederholten KATOOS-/GitHub-/Mesh-Regressionstests.
