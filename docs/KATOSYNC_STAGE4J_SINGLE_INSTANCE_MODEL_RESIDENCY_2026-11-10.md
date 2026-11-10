# KatoSync Stage4J — Single Instance und lokale Modell-Residenz

**Datum:** 10.11.2026 (Europe/Berlin)
**Umfang:** Isolierter macOS-Stage4J-QA-Entwicklungszweig, kein automatisches produktives Update.

## Beobachtung und sofortige Maßnahme

- Vor dem Eingriff: M2 hatte Stage35 **und** Stage4J gleichzeitig offen, M3 nur Stage4J.
- Der alte Stage35-Prozess auf dem M2 hatte keine Child-Prozesse, keine TCP-Listener, keine aktiven Local-Control-Lanes und keine Inbox-Jobs in den geprüften lokalen Daten.
- Die Beenden-Anforderung erfolgte über den regulären macOS-AppleEvent `quit`, nicht durch SIGTERM/SIGKILL. Stage35 beendete sich; Stage4J blieb aktiv.
- **Status nach Eingriff:** auf beiden Macs nur jeweils die bestehende notarisierten Stage4J-QA-Version geöffnet. Das ändert noch nichts am signierten App-Code.

## Native Single-Instance-Hardening (nur Quellzweig)

- Neues `app_instance`-Modul, compile-gated auf macOS + `stage4j-qa`; Headless-Synchronisierung und ältere Produktversionen werden nicht verändert.
- Eindeutige per-Benutzer-Startsperre (`File::try_lock`) mit Eigentümer- und Modusprüfung in einem privaten Ordner. Weitere Starts dürfen nicht gleichzeitig eine zweite neue QA-GUI öffnen.
- Erkennung laufender älterer QA-Apps anhand **derselben Benutzer-ID**, tatsächlichem Programmdateipfad, gültiger Codesignatur, der bekannten MK-Heartbeat-Team-ID und exakter Bundle-ID. Kein bloßes Prozessnamen-Raten.
- Legacy Stage35 hat noch kein kooperatives Handoff-Protokoll. Daher zwingend eine einmalige **Benutzerbestätigung** vor regulärem AppleEvent-`quit`; kein gewaltsamer Abbruch, kein automatischer Vertrauens- oder Kontotransfer. Eine ältere Stage4J mit **identischer Bundle-ID** muss hingegen zuerst in ihrer eigenen GUI beendet werden: Eine AppleEvent-`quit`-Adresse per Bundle-ID könnte sonst die falsche Installation treffen. Der Starter verweigert daher in diesem Sonderfall den Doppelstart.
- Handoff wird bei unlesbarem Status, aktiven Orchestrierungs-Lanes oder Warteschlangen **verweigert**. Auch bei AppleEvent-Fehlern oder unverändert laufendem Altprozess bleibt die neue App gesperrt.
- Noch nicht implementiert: vollautomatische Versionserkennung + kooperativer Handoff mit bestätigtem UI-Draft-/Job-Zustand zwischen zukünftigen Clients, sowie Windows Single-Instance-Mechanismus. Die erste neue QA-Binärdatei mit diesem Guard muss erst separat signiert, notarisiert und auf beiden Macs getestet werden.

- Das nächste signierte Paket wird ausschließlich im separaten QA-Slot `~/.KatoSync-Mesh-Stage4J-SingletonQA` unter `~/Applications` erzeugt; die bereits notarisierten Stage4J- und Stage35-Apps bleiben unverändert. Das ursprüngliche Stage4J-Bundle-ID wird absichtlich beibehalten, um die vorhandene Stage4J-Sitzung nicht zu migrieren.

## Zwei lokale KI-Modelle ohne Doppelbelastung

- M2: 16 GiB Unified Memory, auf dem verifizierten bisherigen KatoSync-Lokalpfad ca. 4,9 GiB Gemma-4-E4B-Modell/Projektion gespeichert. M3: 16 GiB, kein lokales KatoSync-Modellpaket in den geprüften App-Pfaden.
- Der aktuelle Stage4J-Local-Brain-Vertrag listet **nur Gemma 4 E4B Q4_0** als empfohlenes Modell; ein zweiter verifizierter Paketvertrag für Qwen ist noch nicht vorhanden. `127.0.0.1:17842` war auf beiden Macs ohne lokalen Listener.
- Zielarchitektur: Qwen 3 4B für leichte Text-/Agentenarbeit als Kandidat und Gemma 4 E4B für Multimodalität/Fallback, sofern Paketlizenz, Modell-Shas, OS-Runtime und reale Hardwaretests vorliegen. Unabhängig von der endgültigen Rollenwahl sind zwei auf Datenträger gespeicherte Modelle **nicht** zwei parallel geladene Modellserver.
- **Ressourcenregel:** höchstens ein aktiver Local-Brain-Server pro Mac; zweites Modell nur als geprüfte Reserve auf Datenträger. Bei Modellwechsel kontrolliert entladen und danach bedarfsgesteuert laden. Bei kritischem Speicherdruck kein Parallel-Load und keine automatische Downloads/Starts nur aufgrund des GUI-Starts.
- Kein Modell-Download, Keychain-Transfer, automatischer Cloud-Inferenzaufruf oder Agent-Job wurde durch diese QA-Änderung ausgeführt.

## Tests und Abschlussgrenze

**Nachgewiesen:** 861/861 Node-Regressionstests, 2/2 native Rust-Singleton-Tests, TypeScript-Typprüfung und Formatprüfung bestanden. Der nachfolgende Sonderfall-Sicherheitspatch erfordert noch einmal seine gezielten Tests und die neu signierte Hardware-App. Bis dahin ist die **alte** signierte Stage4J-Binärdatei weiterhin ohne dieses neue Single-Instance-Gate.

Created by NMKato Solutions
