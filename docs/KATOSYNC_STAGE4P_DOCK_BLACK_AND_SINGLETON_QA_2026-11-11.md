# Stage4P - schwarzes Dock-Icon, transparentes Original & Singleton-Fix

Stand: 11. November 2026, Europe/Berlin. QA-Funktionsumfang unveraendert.

## Fehlerursachen
1. macOS hinterlegt fuer transparente aeltere App-Icons teilweise eine graue Systemkachel.
   Der Nutzer hat die goldene Kato-AI-Marke darauf als schlecht lesbar bestaetigt.
2. Die signierte Stage4O-GUI verlor ihren Singleton-Startcheck, wenn der
   Local-Control-LaunchAgent zuerst lief: Ein Headless-Prozess wurde faelschlich
   als zweite grafische App erkannt. Reihenfolge GUI zuerst, Daemon danach
   lief hingegen stabil auf echten M2-/M3-Hosts.

## Korrektur (Stage4P-Quellenderung)
- Original-SHA256: 726360cab449bce8abfb9df12bdcbbe89efe0fe451fde5686f5e290c9c50cab3
  bleibt unter branding/master bytegenau erhalten.
- Transparente UI- und Widgetgrafiken bleiben ohne Hintergrund.
- Ausschliesslich die nativen ICNS/ICO-Exports und Native-Icon-PNGs
  erhalten #000000, volle Deckkraft im Hintergrund. Kein zweiter Rahmen,
  keine neue Logoform, kein zusaetzlicher Schatten.
- Singleton-Prozessidentitaet ignoriert --local-control-daemon und
  --run-sync korrekt, ohne andere Programme zu ignorieren.

## Nachweise
- Reproduzierbarer Brandgenerator, schwarzer 1024px-Dock-Icon-Satz,
  identisches Original-Signet, transparentes UI, ICNS roundtrip: PASS.
- Native isolierte Rust-Mode-Tests: 4/4 PASS.
- 15/15 gezielte Node-Regressionstests PASS.
- Keine echten Stage4P-M2/M3-App- oder Neustartstests bis signiertem
  neuen Binary. Die auf beiden Macs laufenden Stage4O-Apps bleiben
  vorerst in der sicher bestaetigten Reihenfolge GUI zuerst, Daemon danach.

## Release-Absicherung
Ein neu erstelltes Dock-Icon aendert das signierte App-Bundle. Beim
Dock-Kontrast-QA-Kandidaten muessen Codesign (Developer ID), Apple Notary,
Staple, Gatekeeper und exakt gehashter Zwei-Host-Pakettransport erneut
bestaetigt werden; alte laufende Apps nicht direkt im Contents-Verzeichnis
aendern. Der native Singleton-Fix ist NICHT automatisch in einem aus dem
alten Stage4O-Binary lediglich neu signierten Icon-Kandidaten enthalten.
Er benoetigt einen eigenen Native-Code-Build mit gesonderter QA. Kein
Remote-/Mesh-Grant, kein DB-Schemawechsel, kein Auto-Merge.

Created by NMKato Solutions
