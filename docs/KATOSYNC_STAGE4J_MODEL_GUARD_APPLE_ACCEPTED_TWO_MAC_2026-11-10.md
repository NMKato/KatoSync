# KatoSync Stage4J — notarized ModelGuard QA on two physical Macs

**Datum:** 10.11.2026, Europe/Berlin
**Quelle:** QA-Branch `qa/stage4j-resources-20261109`, exakter nativer Build-Commit `bf780caad368b1ed9c9185149001445ab988be8c`.
**Umfang:** privater signierter Modellschutz-QA-Kandidat. Kein automatischer Versionswechsel und keine Mesh-Paarung.

## Apple-Notarisierung und Signatur

- Wiederhergestelltes `notarytool`-Keychain-Profil `katosync-stage3x` am 10.11. autorisiert; `notarytool history` erfolgreich. Kein Passwort über Chat oder Script gelesen.
- Bereits zuvor signiertes und durch `unzip -tqq` verifiziertes Notary-ZIP unverändert eingereicht; Vorab-ZIP-SHA-256 `bbbfcf1d680933cd7d2343ddf660f145b1da8f07850633401debb4f2b7e2809f`, Größe **52.806.288 Bytes**.
- Apple `notarytool submit --wait`: **Accepted**, Submission-ID `eeffc8c8-057a-487d-94c0-90770db7bbec`.
- `xcrun stapler staple` + `xcrun stapler validate` auf M2 **PASS**.
- `codesign --verify --deep --strict` **PASS**; `spctl --assess` auf M2 **accepted / Notarized Developer ID**.
- Developer Team-ID `T8SB89JPX7`, Bundle-ID `com.nmkato.katosync.meshqa.stage4j-isolated`.
- `STAGE4J_NATIVE_NAMESPACE_AUDIT_PASS`: eigenes Stage4J-Keychain-/Konfigurations-/LaunchAgent-Namespace; keine früheren Stage35-Keychain-/LaunchAgent-Kennungen.
- Modellschutz-Fehlermeldung `Local-Brain-Port 17842 ist durch einen anderen Dienst belegt` im tatsächlich kompilierten Binärcode nachgewiesen.
- M2- und M3-Main-Binary **SHA-256 identisch**: `d7cc147c2a0613957f3924ef3bd8c5b449168c975cf8bf3f82bbdb7605fb5a22`.

## Post-Staple-Transfer und unabhängige M3-Abnahme

- Neues ZIP **erst nach dem Stapling** erzeugt, `unzip -tqq` PASS; Größe **52.806.959 Bytes**, SHA-256 `edc65c523e596b752c8d8abf33cfb031a13740f5627c594ee5a8d98a6a9b2b83`.
- Private LAN-Strecke M2 `192.168.178.97` → M3 `192.168.178.162`: einmaliger HTTPS-Listener mit vergänglichem Zertifikat/Key, auf M3-Quell-IP und festen ZIP-Pfad begrenzt, Client mit TLS-Public-Key-Pinning. Keine erneute Anmeldung an Cloud-Diensten.
- M3 empfing exakt dieselben **52.806.959 Bytes**, SHA-256 identisch, ZIP-Integrität PASS.
- Der HTTPS-Listener wurde beendet, Port geschlossen und ephemeral Zertifikat/Private-Key/Serverschlüsseldateien gelöscht.
- Auf dem physischen M3: `codesign --verify --deep --strict` PASS, `xcrun stapler validate` PASS, `spctl --assess` **accepted / Notarized Developer ID**; Team-ID und Bundle-ID identisch mit M2.
- Eigenständige M3-Ressourcenprüfung: Typst **0.15.1**, Poppler **26.09.0**, **29 dylibs**, realer temporärer `Typst → PDF → Poppler`-Test **PASS**.

## Regression und Betriebssicherheit

- Node-Regressionssuite: **866/866 PASS**, gezielte ModelGuard-/Singleton-/Isolationsverträge: **21/21 PASS**.
- Native Vorab-Rust-Vertragstests bestanden: belegten Local-Brain-Port fail-closed erkennen; Single-Instance-GUI-Lock/Prozess-Identität.
- Modell-Guard-Build und laufende SingletonFixedQA-App sind **verschiedene signierte Dateien** mit derselben Bundle-ID; das ist kein Nachweis einer automatischen, verlustfreien Handoff-Migration.
- Die neue ModelGuardQA-App ist auf M2 und M3 **nur staged**, wurde **nicht gestartet**. Die bereits laufenden, stabilen SingletonFixedQA-Prozesse wurden nicht beendet, die vorhandenen Arbeitszustände nicht verändert.
- Kein zusätzlicher KatoSync-Modellserver gestartet, keine neue Modellinstallation, kein Remote-Agent-Job, kein SAS-Trust-Receipt, kein Deployment oder Merge.

## Nächste Freigabegates

1. Kontrollierter Instanzwechsel unter Beobachtung: Sicherstellen, dass keine ungespeicherten Jobs/Projekte betroffen sind; alte App regulär schließen und neue ModelGuardQA-App **nur einmal** öffnen; dabei den exklusiven Einzelinstanzschutz und den Keychain-Zustand nachweisen.
2. Modellpakete und Runtime: Gemma 4 E4B plus ein zweites signiertes/gehashtes Qwen-Paket verifizieren; auf 16-GiB-Geräten nur eine aktive Local-Brain-Inferenzruntime, keine Beeinflussung des unabhängigen KAI Desktop.
3. Zwei echte owner-authentifizierte Geräte-Sessions abgleichen, SAS auf M2/M3 menschlich vergleichen und nur mit ausdrücklicher Freigabe dauerhaftes Gerätevertrauen schaffen; danach natives mTLS-Reconnect/Jobtransport QA.
4. Lizenz-/Notice-/Source-Compliance für Poppler und abhängige Komponenten vor öffentlicher Veröffentlichung abschließen.

**Entscheidung:** `STAGE4J_MODEL_GUARD_APPLE_NOTARIZED_AND_TWO_MAC_PACKAGE_QA_PASS`. **Nicht** gleichzusetzen mit aktivem lokalen Doppelmodellbetrieb, bestätigter SAS-Mesh-Paarung oder öffentlicher Produktionsfreigabe.

Created by NMKato Solutions
