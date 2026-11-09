# KatoSync 2.0 Beta – menschenlesbarer Offline-Chat (25.10.2026)

## Ausgangslage und Nutzerbefund
Gemma E4B hatte Sprache und Bild erfolgreich verarbeitet, aber längere Antworten erschienen als Fett-/Markdown-Blöcke mit unordentlichen Aufzählungen und technischen Quellenmarkern. Der Nutzer wünscht eine klare Hierarchie mit normal lesbarem Text. Screenshot-Antworten vermischten Beobachtungen und irrelevante Projektgeschichte.

## Umsetzung
- Lokaler Modellprompt mit echten Absatzumbrüchen statt doppelt maskierten Backslash-N-Zeichen. Nutzerzentriertes Markdown: Kurzantwort, 2–4 relevante Beobachtungen, bei Bedarf Empfehlung oder nächste Schritte. Bildbeobachtung von belegtem Projektwissen unterscheiden, keine frei erfundenen Prozentwerte und kein JSON als sichtbare Chatantwort.
- Reiner TypeScript-Adapter chatAnswerPresentation.ts: Gültige strukturierte JSON-Antworten werden sicher nach benannten Feldern in lesbares Markdown übersetzt; ungültiges JSON wird nicht ausgeführt. Alte kleine-Gemma-Markdown-Fehler (Überschriften mitten im Satz, zusammengeklebte Punkte und beschädigte Fettschrift) werden ausschließlich in der Anzeige repariert. Gespeicherter Originaltext unverändert.
- Zitiernummern nur anzeigen, wenn eine entsprechende verifizierte Quelle separat aus Memory Fabric vorliegt. Das Bild selbst bleibt unbestätigte visuelle Beobachtung, nicht automatisch Projektfakt.
- Ruhigere Antworttypografie: kleinere Überschriften, getrennte Kurzabsätze, Listen, natürliche Schriftstärken und begrenzte Textbreite. Technische Git-/Zeit-Metadaten eingeklappt.
- Für neue Bildfragen: nach erfolgreicher Antwort höchstens 360px breites Miniaturbild unter der Nutzerfrage, ausschließlich flüchtiger React-Zustand, an Projekt und Chatsequenz gebunden, maximal sechs Einträge. Projektwechsel löscht Vorschauen. Kein Speichern in SQLite/GitHub/Projekt-Memory. Bei neuem App-Start verschwinden die Bildvorschauen absichtlich.
- HTML bleibt sicher: ReactMarkdown skipHtml, keine fremden Bild-/Link-Embeds, optionale HTML-Vorschau weiterhin im gesonderten isolierten iframe. Kein Agentenstart und keine Cloud-Requests für Chatformatierung.

## Test- und Release-Gates
- 218 Frontend-Tests inkl. JSON-Fallback, fehlerhaftes Markdown, Quellen-Gate und flüchtiger Bildvorschau.
- 167 Rust-Library-Tests (7 ignoriert), TypeScript/Vite und native macOS-Bündelung separat prüfen.
- User-Abnahme: neue Bildfrage sollte kurze Zusammenfassung, erkennbare Beobachtungen, ggf. Handlungsempfehlung ergeben; ältere Antworten werden sauber dargestellt. Nach Neustart ist das Bild nicht mehr abrufbar, die Antwort bleibt erhalten.
- Public Repo enthält keine Screenshots, Transkripte, Tokens oder privaten Projektinhalte. Keine Stable-Freigabe ohne weiteren UX-/STT-/Signing-/Windows-Abnahme.

Tracking: #126 UX, #132 Multimodal, gestapelte Draft-PRs #134 bis #136.
