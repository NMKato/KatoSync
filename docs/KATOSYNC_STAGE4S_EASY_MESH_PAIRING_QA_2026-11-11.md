# Stage4S – vereinfachte Erstkopplung für KatoSync Mesh

Stand: 11. November 2026, Berlin. Source-only QA bis signierter App-Build.

## Realer Ausgangspunkt
- Stage4R läuft signiert/notarisiert auf M2 und M3.
- Besitzer hat in QA eine Einladung angenommen, einen signierten Relay-Nachweis
  übertragen und auf beiden Macs denselben SAS-Code gesehen.
- Die bisherige UI verlangte zu viele manuelle Schritte (Challenge, Relay,
  Antwort, Peer-Auswahl, Codeeingabe). Das ist kein nutzbares Beta-Onboarding.
- Es ist NOCH KEIN verschlüsselter Peer-Tunnel und kein Remote-Job nachgewiesen.

## Einfacher Ablauf (Stage4S im isolierten QA-Frontend)
1. **Geräte finden:** zuerst bewusst den eigenen KatoOS-App-Schlüssel
   registrieren; danach aktualisiert ein signierter, begrenzter Heartbeat
   die bereits registrierte Präsenz, ohne automatische Trust-Entscheidung.
   Der Roster ist KATOOS-kontogebunden, **NICHT** mDNS/WLAN-only.
2. **Gerät klicken = Verbindung anfragen:** nur frisch gemeldete,
   nicht widerrufene, fremde App-Identitäten. Versand ist eine explizite
   Aktion; keine Einladung beim bloßen Anzeigen.
3. **Auf dem anderen Mac Annehmen/Ablehnen:** ein angezeigter,
   lokal verifizierter Posteingang; höchstens alle 8 Sekunden lesen,
   nur solange die Verbindungen-Seite aktiv ist.
4. **Hintergrund:** nach ausdrücklicher Annahme erzeugt Rust die
   signierte Challenge und sendet sie über den vorhandenen QA-Relay.
   Die sendende Seite validiert Request-ID, lokale und fremde
   Geräte-UUID, Art und Gültigkeit; erzeugt eine signierte Antwort.
   Die empfangende Seite prüft sie in Rust. Kein Auto-Pin.
   Relay-Abfrage nur während einer gültigen, höchstens 10 Minuten
   dauernden aktiven Einladung und höchstens alle 5 Sekunden.
5. **Sicherheitsbestätigung:** Derselbe Code wird auf beiden Bildschirmen
   gezeigt. Kein Abtippen nötig; Nutzer bestätigt auf jedem Mac
   ausdrücklich: "Ja, die Codes stimmen überein". Erst dann
   speichert Rust den öffentlichen Peerschlüssel im lokalen Keychain.
6. **Korrekte Anzeige:** "Geräteschlüssel bestätigt"; NICHT
   "vollständig verbunden", denn mTLS Peer-Transport und
   Remote-Read-Only-Aufträge sind gesondert nachzuweisen.

## Fehlschläge und Grenzen
- Ein unbekannter Fingerprint oder alte Geräte-IDs dürfen keine
  automatische Freigabe erhalten. Bei Identitätsabweichung stoppt
  die Kopplung mit verständlichem Fehler und lässt nur manuelle
  Diagnose zu. Kein stilles Auto-Akzeptieren nur aufgrund des Kontos.
- Backend-Flags und Entitlement/RLS bleiben unverändert.
  Aktive QA-Endpunkte senden nur signierte öffentliche Nachrichten.
- Kein Mailversand, keine Push-Notification außerhalb der geöffneten
  Verbindungen-Seite. Bei Empfang in einem anderen App-Bereich muss
  der Nutzer Verbindungen öffnen.
- Die erste Erkennung ist kontogebunden, nicht an dasselbe WLAN
  gebunden. Echte lokale Peer-Discovery ist weiterhin ein offenes
  Transportthema. Eine WLAN-Vermutung darf keine TLS-Identität ersetzen.
- Kein Merge/Main/Produktion, keine Supabase Migration und keine
  Freischaltung von Remote-Kommandos aus diesem GUI-Polish.

## Build und Qualitätsgate
- Vue/Vite: **React/TS** + Tauri isolierte Stage4J-Backendkennung.
- Staging-Flags nur für diese signierte QA-Version:
  VITE_MESH_EASY_PAIR_QA=1, VITE_STAGE35_HEARTBEAT_QA=1,
  VITE_MESH_INBOX_SEND_QA=1, VITE_MESH_INBOX_RECEIVE_QA=1,
  VITE_MESH_RELAY_QA=1, VITE_KATOOS_AUTH_QA=1.
- Unveränderte native Stage4R-Flags für signierte Send/Receive/Relay,
  keine Auto-Trust-Flag.
- Tests: src/lib/meshEasyPairing.ts, UI-Quellvertrag, Regression,
  TSC, GitHub-CI, neue signierte/notarisierte M2/M3-App.
- Praxis: Senderanfrage, Empfängerannahme, automatischer signierter
  Austausch, SAS auf beiden, getrennte bewusste lokale Bestätigung,
  Widerruf, Timeout, Replay, abweichende Geräte-ID und Offline.
- Anschließende Beta-Sicherheitsfreigabe erst nach E2E-mTLS-/Remote-Job-Gate.

Created by NMKato Solutions
