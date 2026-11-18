# Beta4: Projektwissen, manueller Refresh und Obsidian-Export

## Implementierter Umfang

Stand: **18. November 2026**, neuer Quellstand nach dem signierten
Candidate-3-Paket. Die lokale Chatansicht verwendet das bestehende
projektgebundene RAG aus SQLite/FTS5. Registrierte Projektidentität, Git-HEAD,
Quellhashes und die begrenzte Dokument-Allowlist bestimmen den Kontext.
Nur passende aktuelle verifizierte oder ausdrücklich bestätigte Quellen
dürfen Fakten belegen. Fehlender belegter Kontext bleibt `NOT_IN_MEMORY`.

**Projektwissen sicher aktualisieren** ist jetzt auch bei bereits geladener
Chat-Historie sichtbar. Erst die ausdrückliche Bestätigung startet eine
geprüfte SQLite-Sicherung und danach Migration/Neuindexierung. Die Prüfung
erkennt neue Git-Revisionen sowie bearbeitete, hinzugefügte und entfernte
zugelassene Dokumente am selben HEAD. Projektwurzel, Repository-Identität,
HEAD und Quellhashes werden vor dem Schreiben erneut verglichen. Eine fremde
Repository-Zuordnung wird nicht stillschweigend übernommen. Die bestehende
Chat-Historie bleibt erhalten; das bloße Öffnen der Aktion startet keinen Scan.

**Projektwissen exportieren** öffnet die native Ordnerauswahl für einen
Obsidian-Vault oder Exportordner. Der vorhandene Befehl `memory_fabric_export`
schreibt einen Markdown-Snapshot des gespeicherten Projektstands. Für
aktuelle Quellen ist zuvor der manuelle Refresh nötig. Bearbeitete
Exportdateien werden separat erhalten; die UI zeigt die Anzahl geschriebener,
unveränderter und gesicherter Dateien. Abbruch und Projektwechsel vor dem
Schreibaufruf verhindern den Export; ein verspätetes Ergebnis wird keinem
anderen Projekt zugeordnet.

## Verifikation und Grenzen

- Am Desktop-Stand `aeb171d` vor der Export-Erweiterung bestanden
  **990 Node-Tests**, TypeScript und Webbuild.
- Nach der Export-Erweiterung bestanden **44 gezielte Chat-/Export-Tests**:
  37 bestehende Prüfungen und sieben neue Verhaltenstests für Auswahl,
  Abbruch, Projektwechsel, Ergebnisbindung und Fehler. TypeScript und
  Vite-Produktionsbuild bestanden ebenfalls.
- Vier neue native Tests verwenden echte temporäre Git-Repositories und
  SQLite: Revisionen/RAG/Chat-Erhalt, Änderungen am selben HEAD, fremde
  Repository-Bindung und lesende Schema-Diagnose. Ihre Ausführung im finalen
  Mac-Build ist **noch offen**; `rustfmt --check` bestand.
- Der neue native Ordnerdialog mit tatsächlichem Dateiexport und der
  aktuelle Offline-Inferenzlauf auf dem Zielgerät sind **noch nicht als
  End-to-End-PASS dokumentiert**. Frühere Candidate-3-Paketnachweise decken
  diese späteren Quelländerungen nicht ab.

## Weiterhin offene Integration

`PROJECT_STATUS_FLOW.md` und freigegebene Memory-Dokumente können als
projektgebundene Quellen gelesen werden. Der Rolling-Status-Projektor und
der Cross-Project-Index sind weiterhin isolierte QA-Bausteine; ein produktiver
automatischer Status-Writer, gemeinsame Cross-Repo-Abfragen und
Mesh-Wissensreplikation fehlen. Private Operator-Dateien bleiben gitignored;
uncommitted Daten werden durch einen Refresh nicht automatisch verifizierte
Fakten. Der Export ist eine Projektion und keine bidirektionale Obsidian-Synchronisation.

Local Brain benötigt eine tatsächlich installierte und gestartete lokale
Runtime samt Modell. Der vorhandene Provider-Fallback-Planer startet bei
einem Provider-Ausfall keinen automatischen lokalen Ersatzrunner. Auch der
separat implementierte lesende Git-Status erteilt keine allgemeine
Terminal-/CLI-/Computersteuerung. Diese Integrationen sowie die vollständige
4.0-Freigabe bleiben offen.

## Quellen

- [Memory-Fabric-Vertrag](MEMORY_FABRIC.md)
- [Native Continuity-Brücke und Git-/SQLite-Tests](../src-tauri/src/memory_fabric/continuity_bridge.rs)
- [Lokale Chatansicht](../src/components/ContinuityLocalChatPanel.tsx)
- [Export-Adapter](../src/lib/projectMemoryExport.ts) und [Verhaltenstests](../tests/projectMemoryExport.test.ts)
- [Nativer Markdown-Export](../src-tauri/src/memory_fabric/projection.rs)
- [Rolling-Status-QA und ihre Grenzen](KATOSYNC_STATUS_FLOW_ROLLING_QA_2026-11-09.md)
- [Cross-Repo-/Memory-Audit](KATOSYNC_STAGE4K_RESOURCE_BRANCH_MEMORY_AUDIT_2026-11-10.md)
- [Nativer Git-Status](KATOSYNC_BETA4_NATIVE_GIT_STATUS_20261118.md)
- [Aktuelles Beta4-Integrationsprotokoll](KATOSYNC_BETA4_INTEGRATION_20261118.md)
