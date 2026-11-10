# KatoSync Stage4J – verifizierte Gemma- und llama.cpp-Übernahme auf dem M2

Stand: 10.11.2026. Private QA; keine Modellinferenz oder öffentliche Auslieferung.

## Ausgangszustand
- Auf dem M2 ist nur die notarisierten Stage4J ModelGuard-App (PID 71328) aktiv. KatoSync-Modellport 17842 war frei.
- Der unabhängige KAI-Desktop-Modellserver bleibt auf Port 61814 aktiv.
- Die vorhandenen Gemma-Dateien lagen im alten App-Speicher com.nmkato.katosync.meshqa/local-brain und waren im neuen isolierten Stage4J-Bereich zuvor nicht vorhanden.

## Sichere APFS-Modellübernahme
Werkzeug: scripts/qa-stage4j-adopt-verified-gemma-m2.py

- Standardmodus --preflight ist vollständig lesend. Vorabprüfung mit komplettem SHA-256-Abgleich bestanden.
- Gemma 4 E4B Q4_0: 4.590.807.392 Bytes, SHA-256 a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2.
- Vision-Projektor: 559.874.816 Bytes, SHA-256 197f49a93027f9843772bd24a6a9e0be2a32a788de5a3def330e9c585d86edd1.
- Manifest, ursprünglicher Paket-Ledger und die beiden Modelldateien wurden vor und nach der Übernahme kontrolliert.
- Dateien mit APFS-Copy-on-Write (cp -c) in einen privaten Staging-Bereich geklont. Unterschiedliche Inodes, keine Hardlinks. Anschließend atomar nach com.nmkato.katosync.meshqa.stage4j-isolated/local-brain übernommen.
- Ursprüngliche Dateien und ältere Runtime bleiben unangetastet; keine erneute Modell-Übertragung aus dem Internet.
- Freier Speicher vor/nach Übernahme: 34.732.456 KiB auf 34.698.392 KiB, also rund 33 MiB zusätzliche Belegung anstelle einer weiteren 5-GB-Vollkopie.
- Ergebnis: STAGE4J_GEMMA_APFS_CLONE_ADOPTED, STAGE4J_NO_RUNTIME_COPIED_NO_MODEL_STARTED.

## Offizielle gepinnte llama.cpp-Laufzeit
Werkzeug: scripts/qa-stage4j-install-pinned-llama-m2.py

- Die ältere, lediglich ad-hoc-signierte Runtime wurde nicht kopiert.
- Die in src/lib/localBrainManifest.json festgelegte GitHub-Version llama.cpp b11272 für macOS ARM64 wurde gesondert heruntergeladen, 11.767.510 Bytes.
- Geprüfte Archiv-SHA-256: 1ef6db9f1913725a9a7522f1719e987c88329f266e906270436b23d662985a20.
- Das Archiv enthält 61 Mitglieder. Exakte Pfadgrenzen, erlaubte Datei-/Verzeichnistypen, gültige relative Symlink-Ziele und azyklische Linkketten wurden vor dem Entpacken geprüft. Python TAR-Extraktion zusätzlich mit sicherem data-Filter.
- Festgestellter SHA-256 des llama-server: 6a072f8bf308ea28144476441d25760ee01b84ed102f86be4662d21ace8d72a6.
- Code-Signaturprüfung, LICENSE und harmloser Versionsaufruf erfolgreich: version 0.5.0-dev, build 11272, commit 7fee17846.
- Die Laufzeit wurde atomar in den isolierten Runtime-Ordner aufgenommen, ohne die ältere Runtime zu ersetzen.
- Ergebnis: STAGE4J_PINNED_LLAMA_CPP_RUNTIME_INSTALLED und STAGE4J_NO_LOCAL_MODEL_LAUNCHED.

## Regression und Negativprüfungen

- Gemma-Übernahmehelfer: 4/4 gezielte Quell-Vertragstests bestanden.
- Gepinnter llama.cpp-Installer: 3/3 gezielte Quell-Vertragstests bestanden.
- Fehlgeschlagene, wiederholte Installation wurde geprüft: Modellpaket und Laufzeit verweigerten einen erneuten Eingriff in ein belegtes Ziel, jeweils Exit-Code 7. Bestehende Dateien und KAI Desktop blieben unverändert.
- Erster vollständiger Lauf mit test-concurrency=4: 877/878 bestanden; ein schon zuvor auffälliger Mesh-Inbox-CLI-Unterprozess überschritt bei paralleler Last erneut sein unverändertes 2-Sekunden-Testlimit.
- Isolierter Gegencheck dieser Mesh-Inbox-Testdatei: 8/8 bestanden.
- Abschließender vollständiger Lauf mit test-concurrency=2, ohne Änderung an Testinhalt und Timeouts: 878/878 bestanden, 0 Fehler.
- Kein automatischer Modellstart, kein neuer Remote-Agentenauftrag, keine App-Migration auf M3, kein GitHub-Push oder Merge.

## Noch offene Abnahmegrenzen
- Die Dateien sind lokal vorbereitet; die tatsächliche Modellanzeige im Stage4J-UI, das Laden und Entladen sowie eine echte Gemma-Inferenz sind noch nicht getestet.
- KatoSync darf auf 16-GiB-Rechnern nicht ungeprüft mehrere eigene große Modelle gleichzeitig laden. Qwen ist bislang weder installiert noch in einem signierten zweiten Modellvertrag hinterlegt.
- M3 bleibt mit der bisherigen SingletonFixedQA aktiv; die neue ModelGuard-App wurde dort noch nicht vom Eigentümer freigegeben. Keine Modell-Dateien oder Laufzeit wurden nach M3 übertragen.
- Mesh-SAS-Paarung, native App-mTLS-Aufträge sowie die Lizenz-/Source-Compliance für eine öffentliche Auslieferung bleiben gesondert ausstehend.

Status: STAGE4J_M2_GEMMA_VERIFIED_COW_AND_PINNED_RUNTIME_INSTALLED_NO_INFERENCE.

Created by NMKato Solutions
