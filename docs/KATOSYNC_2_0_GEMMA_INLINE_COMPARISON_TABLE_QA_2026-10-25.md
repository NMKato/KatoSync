# KatoSync 2.0 – Gemma Inline-Markdown-Tabellen reparieren (25.10.2026)

## Fehlerbild
Im lokalen Master-Chat war eine ältere Auskunft durch den Human-Readable-Adapter nach PR #138 korrekt gegliedert. Beim unmittelbaren Folgetest zur Gegenüberstellung von lokalem Modell, Codex und Claude Code kam erneut eine lange, fettgedruckte Antwort ohne sichtbare Vergleichstabelle. Gemma E4B hatte Tabellenkopf, Alignment-Zeile und mehrere Datenzeilen ohne notwendige Zeilenumbrüche erzeugt. Der bisherige Renderer reparierte Überschriften, aber nicht einzeilige GFM-Tabellen.

## Korrektur – keine erfundenen Tabellenwerte
- Neuer reiner Anzeigeadapter repairInlineMarkdownTables erkennt begrenzte, rechteckige Markdown-Tabellen mit 2–5 Spalten, echter Trennzeile aus drei Bindestrichen und 1–12 vollständigen Datenzeilen, selbst wenn das Modell alles in dieselbe Textzeile geschrieben hat. Er schreibt ausschließlich Trenner und Zeilenumbrüche um; vorhandene Zellen- und Quellentexte werden nicht erfunden oder inhaltlich geändert.
- Normale Tabellen mit korrekten Umbrüchen, Codeblöcke, defekte und unvollständige Tabellen bleiben unverändert. Kein eigenmächtiges Auffüllen von fehlenden Zellen.
- Modellprompt beim expliziten Wunsch nach einer Tabelle erhält ein kurzes Markdown-Zeilenformat-Beispiel und den Hinweis, alle genannten Anbieter zu behandeln; fehlt ein belegtes Merkmal, ist „Nicht belegt“ statt erfundener Produkteigenschaften auszugeben. Kein Agenten-/Mesh-JSON-Vertrag geändert.
- Bereits gespeicherte Textantworten profitieren beim erneuten Anzeigen von der Reparatur. Die Rohantwort in Memory Fabric wird nicht manipuliert. Die vorhandene ReactMarkdown-Ausgabe mit skipHtml, ohne Link-/Bild-Embeds, bleibt unverändert.
- Kein Screenshot, kein privater Chattext, keine Zugangsdaten ins öffentliche Repo gestellt. Regressionstests benutzen synthetische Beispieldaten.

## Test-/Freigabegate
- 228/228 Node-Tests bestanden, inkl. fünf neuer Tests für ursprünglich einzeilige Tabellen, ungültige Tabelle, Quellennummern, Codeblöcke und Backend-Anweisung.
- 167 Rust-Tests bestanden, 7 ignoriert; TypeScript/Vite und macOS Release-App separat geprüft.
- Ziel: Nutzer öffnet nach isoliertem QA-Neustart seine bisherige Codex-/Claude-Vergleichsantwort. Überschrift, normaler Fließtext, richtige Tabelle und Fazit müssen einzeln erkennbar sein. Optional erneute Frage mit drei Anbietern stellen; fehlende Belege klar als fehlend markieren.
- Bis zur visuellen Benutzerabnahme Draft, kein Merge nach main, kein autonomes Schreiben und keine Stable-Veröffentlichung.
