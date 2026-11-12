# Stage4X – eindeutige Mesh-Bedienung und Auswahl bereits gekoppelter Geräte

NMKato Solutions | 12. November 2026 | Source-only QA, stacked onto Stage4W PR #262

## Nutzerproblem
In der Easy-Pair-Liste war die Geräte-Schaltfläche im aktivierten Easy-Modus nur bei einer noch zulässigen **neuen Einladung** klickbar. Bereits lokal bestätigte Macs konnten nach erfolgreicher Kopplung nicht erneut ausgewählt werden. Die technische Stage4W-LAN-Prüfung verlangte aber ein selektiertes, lokal gepinntes Gegenüber. Außerdem war für nichttechnische Nutzer „Gekoppelt“ zu leicht mit „Sichere Verbindung aktiv“ zu verwechseln.

## Lösung
- Lokal bereits bestätigte Geräte können in der QA-Ansicht wieder ausgewählt werden. Dabei wird keine neue Einladung gesendet.
- Eine bekannte lokale Genehmigung unterdrückt Doppeleinladungen auch ohne Stage4W-QA-Flag.
- Bei nicht lesbarem lokalem Pin-Inventar wird das Versenden bis zur erneuten Prüfung gesperrt (fail-closed).
- Die neue Auswahl ist nur für lokal zugelassene, nicht widerrufene, nicht eigene und wohlgeformt identifizierte Geräte verfügbar; das native Backend überprüft weiterhin KATOOS-Owner, Enrollment und Keychain-Pin.
- Während eines laufenden LAN-Testvorgangs wird die Auswahl nicht gewechselt.
- Drei sichtbare, klar getrennte Zustandsbereiche: (1) lokaler Geräteschlüssel, (2) lebender verschlüsselter Netzwerkkontext, (3) Remote-Steuerungsberechtigung. Stage 2 und 3 bleiben ausdrücklich „nicht aktiv“; ein einmaliger TLS-Test darf die Live-Anzeige nicht umschalten.
- Unaufdringliche Glaskarten im bestehenden hellen/dunklen Farbsystem, anpassbar an mobile Breiten; zugängliche Gruppenbeschriftung.
- Neue Oberfläche in DE/EN/RU/ES. Fachliche IP-/Port-Eingaben bleiben ausschließlich im aufklappbaren fortgeschrittenen QA-Bereich.

## Release-Gates
1. Stage4W/Stage4X gezielte Node-Vertragstests und vollständiger TypeScript-/Vite-Build bestanden.
2. GitHub-CI grün; PR bleibt Draft, kein Merge oder produktiver Rollout.
3. Geänderte Weboberfläche muss vor einem realen Geräte-LAN-QA-Test in ein **neu gebautes und neu signiertes** macOS-App-Bundle eingebettet werden.
4. Die zuvor signierten, notarisierten Stage4W-Bundles auf M2/M3 wurden durch diese Source-only-Änderungen **nicht aktualisiert**.
5. Reale TLS-Gegenstelle, Live-Heartbeat und Remote-Job-Berechtigungen bleiben separate überprüfungspflichtige Freigabeschritte.

## Negative Prüfung
Abgewiesene Geräte, unbekannte lokale Schlüssel, eigenes Gerät, ungültiger Fingerprint, fehlendes QA-Flag und leeres Inventar dürfen weder als lokaler Testpartner erscheinen noch eine neue Einladung erzeugen. Bereits lokal bestätigte Geräte dürfen nie ungefragt erneut eingeladen werden. UI-Status „Verbindung aktiv“ bzw. „Fernsteuerung erlaubt“ darf nicht durch eine lokale Pairing-Freigabe entstehen.
