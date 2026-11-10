# Stage4J — Zwei-Modell-Residenz, Ressourcen- und Start-Sicherheitsprüfung

**Datum:** 2026-11-10 · **Umfang:** interne Stage4J-Quellprüfung und Live-Inventar auf M2/M3, ohne Modellinstallation, neue Cloud-Kosten oder automatische Inferenz.

## Nachgewiesener Geräte- und Dateibestand

- **M2 (16 GiB RAM):** Bereits vorhandenes älteres Gemma-4-E4B-GGUF-Modell mit 4.590.807.392 Bytes sowie Vision-Projektor mit 559.874.816 Bytes. Beide Dateien wurden am 10.11. mit **vollständiger SHA-256-Prüfung** gegen das vorhandene `src/lib/localBrainManifest.json` verifiziert. Sie liegen in **älteren** App-Speicherbereichen, nicht als fertig installierte Stage4J-Pakete im isolierten Stage4J-Verzeichnis.
- **M3 (16 GiB RAM):** Keine dieser GGUF-Dateien in den geprüften KatoSync-App-Speicherbereichen. Speicherplatz und Inhalt des alten M2 dürfen nicht mit dem M3 als vorhanden gleichgesetzt werden.
- **M2:** Ein unabhängiger KAI-Desktop-`llama-server` läuft unter `127.0.0.1:61814` mit Gemma 3 1B. Dieser **gehört nicht** dem KatoSync-Local-Brain und darf weder beendet noch überschrieben werden.
- **M2/M3:** Zum Prüfzeitpunkt kein Listener des KatoSync-Local-Brain am internen Port `127.0.0.1:17842`. Ein nicht belegter Port beweist **keine installierten Modelle**.
- **Aktueller Produktvertrag:** `localBrainManifest.json` enthält **einen** empfohlenen Modellvertrag: Gemma 4 E4B Q4_0. Ein zweiter Qwen-Eintrag mit festgelegter Version/Datei/Hash/Provenienz und Releaseprüfung ist noch **nicht** integriert.

## Bereits getestete Single-Instance-Grenze

Auf beiden physischen Macs wurde die neuere, Apple-notarisierte Stage4J-SingletonFixedQA-App geöffnet. Ein erneuter `open -n`-Versuch ließ jeweils **exakt einen Stage4J-GUI-Prozess** bestehen. Bestehende Einstellungen wurden nicht migriert oder zurückgesetzt. Die beiden Macs können selbstverständlich jeweils ihre **eigene** Instanz betreiben. M2 und M3 tragen identische signierte Hauptbinärdateien und ZIP-Prüfsummen.

## Neue Quellschutzmaßnahme: kein doppelter Modellstart

Der bisherige `local_brain::start`-Weg prüfte die bestehende Laufzeit, ließ aber **parallele UI-Startanforderungen vor dem ersten Spawn** dieselbe Prüfung gleichzeitig passieren. Diese Race Condition wird nun mit einer pro-Prozess-Async-Start-Sperre verhindert:

1. `MODEL_START_LOCK` umschließt das vollständige asynchrone Starten einschließlich Dateiverifikation und Health-Check sowie das explizite `stop`.
2. Ein unbekannter bereits belegter **KatoSync-Loopback-Port 17842** führt zum sicheren Abbruch anstatt eines zweiten Serverstarts. Keine fremden Prozesse werden beendet.
3. Fehlende oder unzureichende erkannte RAM-Kapazität wird vor dem Start als Fehler behandelt; die Manifest-Mindest-RAM-Vorgabe gilt nun auch für den wirklichen Startpfad.
4. Das bisherige bewusste Verhalten bleibt: GUI-Start allein lädt **kein** Modell. Andere Produktdienste, insbesondere der KAI-Desktop-Server auf Port 61814, werden nicht angesprochen.

## Nächste sichere Ausbaustufe

**Zwei Modelle auf Datenträger, maximal ein KatoSync-Modell zurzeit geladen:** Gemma 4 E4B für multimodale Aufgaben und optional **Qwen3-4B Q4_K_M** als kleineres Text-/Agentenmodell. Der offizielle Qwen-GGUF-Quellbestand unter `https://huggingface.co/Qwen/Qwen3-4B-GGUF` nennt Apache-2.0 und eine Q4_K_M-Datei von etwa 2,5 GB. Bevor Qwen als echtes Paket in der App aktivierbar wird: exakte Revision und SHA-256 pinnen, Runtime und Lizenz-/Notice-Verteilung prüfen, Speicherbudget definieren, Modelle auf M2/M3 separat installieren und die Umschaltung mit echtem Health-/Inferenz-Nachweis testen.

**Wichtig:** Der neue Startschutz ist zunächst eine **Quelländerung**. Er ist noch nicht Bestandteil der bereits signierten Stage4J-App, solange keine neue Build-, Signatur- und Apple-Notarisierungsprüfung abgeschlossen wurde. Weder zwei installierte lokale Modelle noch ein automatischer Modellwechsel werden dadurch vorgetäuscht. Öffentliche Modellverteilung bleibt bis zur Lizenzfreigabe gesperrt.

## Kontrollierte Regression nach dem Quell-Fix

- **865/865** vollständige Node-Tests bestanden, keine fehlgeschlagenen Tests.
- **4/4** gezielte Stage4J-Modellresidenz-Vertragstests bestanden (in der vollständigen Node-Suite enthalten).
- **1/1** nativer Rust-Test: belegten lokalen Loopback-Port sicher erkannt; kein Modellserver gestartet oder fremder Prozess beendet.
- **2/2** native Rust-Single-Instance-Tests erneut bestanden: exklusiver Benutzer-Lock und exakte Prozessidentität.
- Rust-Formatprüfung bestanden.
- Source-Commit: `d56f8a1` auf `qa/stage4j-resources-20261109`. Keine App-Signierung, Notarisierung, Mesh-Kopplung, Cloud-Migration, Modellinstallation oder GitHub-Push infolge dieses Fixes.

Created by NMKato Solutions
