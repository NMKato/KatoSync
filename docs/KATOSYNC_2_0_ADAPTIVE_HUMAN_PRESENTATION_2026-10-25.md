# KatoSync 2.0 – Adaptive menschenlesbare Chat-Ausgabe (25.10.2026)

## Befund
Der Nutzer bestätigte die ersten Bild-/Offline-Diktat-Funktionen, bemängelt aber im neuen Chat weiterhin großflächige Fettschrift und Absätze, die wie eine einzelne fette Überschrift erscheinen. Antworten sollten nach Inhaltsform entweder natürliches Deutsch, Schritte, Vergleichstabellen oder ggf. Diagramme sein. Strukturierte JSON-Nachrichten bleiben dem Agenten-/Mesh-Datenverkehr vorbehalten und dürfen nicht als rohe Chatansicht erscheinen.

## MVP-Korrektur
- Vorhandener rein clientseitiger Anzeigeadapter rekonstruiert auch aus alten falsch formatierten lokalen Gemma-Antworten separate Kurz-Überschriften, Absätze und Listen. Überlange ungewollte Markdown-Fettschrift wird entschärft; aus Modellsätzen werden keine neuen Fakten abgeleitet. Rohantwort in lokaler DB bleibt unverändert.
- Normaler Chattext CSS-seitig mit regulärem Schriftschnitt, Überschriften und gezielte Labels abgesetzt.
- Rust-Prompt lässt das Format offen: natürliche Absätze für Erklärung, nummerierte Liste für Aktionen, Markdown-Tabelle für belegte Vergleiche. Keine starre 3-Überschriften-Pflicht oder Maschinen-JSON als Benutzerantwort, keine erfundenen Fortschrittswerte.
- Optionaler strikter Human-View-Vertrag für reine Frontend-Präsentation aus JSON (Tabellen mit begrenzten Spalten und Zeilen, Balkendiagramme mit endlichen positiven/Null-Werten und mindestens einem unabhängig vorhandenen Memory-Fabric-Quellenindex). Unbekannte, ungültige oder bösartige Strukturen werden nicht als Widget akzeptiert. Keine HTML-/Netzwerkausführung. Bereits vorhandene Markdown-Tabellen werden unverändert über GFM gerendert.
- **Wichtiger Integritätsvorbehalt:** Ein vorhandener Quellenindex beweist NICHT, dass jede numerische LLM-Angabe in der Quelle vorkommt. Balken zeigen deshalb ausdrücklich „Modellantwort, Einzelwerte nicht unabhängig verifiziert“ und dürfen NICHT als bestätigt gemessener Projektfortschritt interpretiert werden. Für späteres produktives Analytics-/MVP-Fortschrittsdiagramm müssen die Zahlen erst über eine vertrauenswürdige strukturierte Messwertquelle belegt werden; kein Automatismus, der aus Text falsche Prozentwerte ableitet.
- Menschliche Ausgabe und bestehende Maschinen-JSON-/Agentenverträge sind architektonisch getrennt. Agentenstart, Schreibfreigabe, Mesh und bestehende Quellenprüfungen bleiben unangetastet.

## Qualität und Abnahme
- Node-Tests decken die konkrete alte Antwortform (auf einer Zeile verklebte Überschriften, Fettdruck und Bullet-Listen), Tabellen-Schema, Diagramm-Provenienz-Gate und Fallback für ungültige Zahlendaten ab.
- Rust-Library-, TypeScript-, Vite- und nativer macOS-Build gesondert prüfen.
- Echte Abnahme: die bisherige Antwort im Master-Chat nach dem Update visuell prüfen sowie neue Status-/Vergleichsfrage stellen. Wichtig sind normale Fließtextstärken und die Trennung zwischen Überschrift, Punkten und Quellen.
- Daten und private Screenshots bleiben lokal; im öffentlichen GitHub nur Code, Tests und sachlicher Projektstatus.

Tracking: #126 Chat-UX / Draft PR auf #137; kein Main-Merge, bevor der Nutzer die neue Darstellung abgenommen hat.
