# KatoSync 2.0 Beta – Gemma offline multimodal, 25.10.2026

## Ziel
Offline mit Gemma texten, ein PNG/JPEG oder einen Screenshot zur Analyse einfügen,
Markdown/Tabellen/Code angenehm lesen und HTML-Beispiele nur im isolierten
Vorschaurahmen ansehen. Lokale Mikrofon-Diktate füllen das Eingabefeld ohne Auto-Senden.

## Gemma-Liveprüfung M2
- E4B-Q4-Modell und Q8-Multimodal-Projektor per SHA-256 vollständig geprüft.
- Ursprünglicher Server meldete Vision false. Nach kontrolliertem Neustart eines
  inaktiven localhost-Modellservers ist der Projektor geladen; Vision true.
- Selbst erzeugtes Testbild: großes rotes Feld mit 73. Gemma erkannte Farbe und
  Zahl korrekt innerhalb von 3,7 Sekunden über Loopback-API, ohne Cloud.
- Backend prüft Bildsignatur, Format, Größe und aktive Vision-Schnittstelle.
  Bilddaten werden niemals in Memory Fabric persistiert; der Verlauf vermerkt
  die Bildverwendung. Keine fingierte Antwort bei defekter Vision.

## Chat-UX / Sicherheit
- React-Markdown mit Tabellen, Listen, Überschriften und Code; keine rohe HTML-Ausführung.
- Ein optionaler HTML-Codeblock kann in einer Sandbox mit CSP ohne Netzwerk und
  ohne Skriptausführung als Vorschau dargestellt werden.
- PNG/JPEG per Anhängen, Zwischenablage oder Drag & Drop; im Browser offline
  verkleinert. Projektquellen getrennt von unbelegter Bildbeobachtung.
- Prozentzahlen werden nicht frei ausgedacht; verifizierte Kennzahlen
  gehören in strukturierte Statusdaten des Projekts.

## Diktat
- Apple de-DE On-Device Speech auf M2 als verfügbar geprüft.
- Swift-Helfer erzwingt reine On-Device-Recognition und fragt die macOS-Freigabe;
  Mikrofonaufnahme maximal zwölf Sekunden, kein Cloud-Fallback, keine Audiodatei.
- Neue Tauri-Kommandos geben nur den erkannten Text an den Editor, keine
  automatische Nachricht. Der Helfer wird mit dem macOS App-Paket gebündelt.
- Erste echte Mikrofonprobe wartet auf ausdrückliche Nutzerfreigabe.
  Windows-STT bleibt bis eigenem Offline-Test gesperrt (#133).

## Test-/Release-Gates
- Native Build/Unit-Tests und QA-App müssen freigegeben sein.
- Ein Screenshot muss noch über das KatoSync-Chatfeld end-to-end geprüft werden,
  außerdem Clipboard, Berechtigungen und realer macOS-Diktierlauf.
- Eine Bilddatei wird absichtlich nicht dauerhaft gespeichert. Verweise
  auf ältere Bildinhalte brauchen erneut einen Anhang.
- Keine Freigabe autonomer Schreibagenten/Windows-/Mesh-3.0-Stable.
- Öffentliches Repo enthält keine Screenshots, Keys oder private Dateipfade.

Tracking: #132, #133, #126, #76.
