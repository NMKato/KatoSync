# Stage4Q – Mesh-Verbindungsoberflaeche ohne irrefuehrende Kopplung

11. November 2026, Berlin – Quellcode-QA, noch keine installierte neue App.

## Live Befund
- M2 und M3: je eine Stage4P GUI mit passendem lokalen Auftragsdaemon.
- Kein nativer KatoSync Mesh-TCP-Listener; keine gesicherte Mesh-Verbindung.
- Das aktuell verwendete Build-Skript aktiviert KATOOS Auth QA, aber nicht
  die beiden Frontend-Flags VITE_MESH_INBOX_SEND_QA und RECEIVE_QA.
  Die Rust-Funktionen verlangen eigene Native-Build-Flags.
- Ein Klick auf Einladung vorbereiten erzeugt nur einen lokalen signierten
  Entwurf, keine Servernachricht und somit keinen Annehmen-Button.
- Namen wie KAI Echo, KAI Nexus und KAI Atlas entsprechen kryptografischen
  App-Identitaeten. Mehrere Versionen koennen am gleichen Mac eingetragen sein.
  Aeltere Eintraege bleiben im eingeklappten Verlauf.
- Die Server-Registry meldet derzeit nur macOS, Windows oder Linux,
  aber kein gesichert ermitteltes MacBook-Modell.

## UI-Korrektur
- Ohne aktivierten Send- und Receive-Gate erscheinen deutliche Hinweise
  anstatt einer irrefuehrenden Verbindungswirkung.
- Die signierte lokale Vorbereitung wandert in einen aufklappbaren
  Abschnitt fuer technische QA.
- Geraetekarten zeigen die gesicherte Betriebssystemfamilie, die
  App-ID-Endung zur Unterscheidung und den zuletzt gemeldeten Zeitpunkt.
  Die lokal ermittelte Chipfamilie darf beim eigenen Rechner erscheinen;
  fremde Modellnamen werden niemals erraten.
- Bei freigeschaltetem Versand bleibt die vorhandene ausdrueckliche
  Aktion zum Senden der Anfrage und zum Abrufen/Annehmen am Ziel erhalten.
- Gleicher Account ist nur Discovery, NICHT automatisches Trust.

## Abnahme-Holds
- Fuer den eigentlichen End-to-End-Test braucht es einen separat signierten
  QA-Build, passende Rust- und Web-Flags, gepruefte QA-Backend-Flags sowie
  ausdruecklich bestaetigten SAS-Code beider Seiten.
- Eine angenommene Einladung ist keine mTLS-Verbindung und kein Remote-Job.
  Kein automatischer Trust oder Produktionseinsatz aus dieser UI-Aenderung.
- Keine DB-Migration, kein Deployment, keine Loeschung von Altidentitaeten.

Created by NMKato Solutions

## Stage4Q native QA route correction
Read-only Supabase inventory found deployed QA functions named
mesh-inbox-send-qa, mesh-inbox-receive-qa and mesh-pairing-relay-qa.
The native functions had called unsuffixed names. The isolated QA source now
references only matching QA endpoint slugs; the existing native compile-time
opt-in flags remain required, as do the separate web flags and server gates.
No functions or flags were activated by this source correction.
The server-side secret gating and atomic entitlement/revocation enforcement
must be independently verified before any real owner pairing test.
