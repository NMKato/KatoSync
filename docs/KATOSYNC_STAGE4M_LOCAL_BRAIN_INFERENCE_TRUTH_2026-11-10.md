# Stage4M – wahrheitsgetreue lokale Modellbereitschaft

**Datum:** 10. November 2026, isolierter QA-Branch. Kein Installationseingriff, keine Produktivfreigabe.

## Problem

Bisher konnte local_brain::status() den Wert running=true bereits aus einem
lebenden Child-Prozess ableiten. Ein Prozess beweist aber nicht, dass auf
127.0.0.1:17842 ein bereitgestelltes, korrekt geladenes KatoSync-Modell
antwortet. Im UI konnte damit fälschlich „läuft“ angezeigt werden.

## Korrektur

- Status running=true gilt nur bei installierter/erkannter Runtime,
  installiertem KatoSync-Modellpaket, gesundem lokalen HTTP-Modellserver
  UND vorhandenem exakt gepinntem Alias in /v1/models.
- Ein eigener Child-Prozess bleibt ein Prozessindikator, aber kein Beleg
  für erfolgreiche Inferenz.
- Der explizite Modellstart wartet jetzt auf HEALTH+ALIAS, nicht nur
  auf HTTP-200 unter /health; ein falscher Server wird nie als
  erfolgreich gestarteter KatoSync Local Brain ausgegeben.
- Minimierung/GUI-Coordinator wird dadurch nicht in ein fremdes Modell
  umgedeutet. Kein neuer Autostart, keine Modellinstallation und
  insbesondere kein Abschießen fremder KAI-Desktop-/llama-Prozesse.
- Das zusätzliche Gate ist rein in-memory und verursacht keinen
  Cloud-/Supabase-Aufruf.

## Abnahme

- 4/4 native Rust-Unit-Tests des exakt eingebundenen neuen Rust-Moduls
  mit rustc --test PASS.
- 3/3 neue Node-Quellintegrationstests PASS.
- Stage4J/Stage4K Kompatibilität: gezielte 29/29 Node-Tests PASS.
- GitHub PR Fast Gate: neuer, isolierter Rust-Native-Check im
  vorhandenen Rust-Format-Job, ohne zusätzlichen Runner/Deployment.

## Grenzen

- /health + /v1/models sind ein technischer Runtime-Readiness-Check,
  keine kryptografische Eigentumsattestierung gegen kompromittierte
  Loopback-Dienste. Für einen externen Remote-Grant sind weiterhin
  signierte Session-/Device-Identität, gepinnte Pakete und Keychain-
  Schutz erforderlich.
- Der neue Code ist NICHT in den bereits auf M2/M3 installierten
  Stage4J-QA-Apps; erst ein signierter und notarisierter QA-Build kann
  diesen UI-Zustand live abbilden.
- Das Gemma-4-Modell wurde nicht geladen oder inferiert.
- Keine Aufweichung des Gate9-/Owner-/Mesh-/Lizenz-Freigabeprozesses.

**Entscheidung:** Source-QA-Readiness-Trennung implementiert;
Remote- und Produktionsfreigaben bleiben gesperrt.

Created by NMKato Solutions


## Build- und Signaturversuch am M2 (10.11.2026, 20:55–21:11 MEZ)

- In einem eigenen, kollisionsgeschuetzten Stage4M-Readiness-QA-Slot
  wurde der exakt gepinnte Source-HEAD e0575c58dd41232e01cf7b9b9f4cc4c1147818df
  mit dem vorhandenen Developer-ID-Signer vorbereitet.
- Unveraenderte, bereits gepruefte STT-/Poppler-/Typst-/Lizenzressourcen
  wurden nur in den isolierten Worktree kopiert; Audit bestaetigte
  29 eingebettete Poppler-Libraries, 4 Lizenzfiles, unveraenderten SHA-Lock.
- Erster Preflight zeigte einen macOS-spezifischen mktemp-Template-Fehler.
  Dieser wurde in e0575c5 behoben. Zweiter Anlauf:
  TypeScript + Vite Production-Build PASS (ein Bundle-Size-Warning).
- Cargo wurde mit vorhandenem 13-GB-Buildcache und maximal 2 Jobs gestartet.
  Rustc baute die grosse native Tauri-KatoSync-Library, gab nur Dead-Code-
  Warnungen aus, lief jedoch nach 15 Minuten weiterhin mit erheblicher CPU.
  Es gab bis dahin keine Compiler-Abbruchdiagnose.
- Der EIGENE Build wurde deshalb kontrolliert beendet; keine fremden
  Modellprozesse wurden beendet, bestehende Stage4J-App unveraendert.
- **Es entstand KEIN fertiges Stage4M-App-Bundle, keine Developer-ID-
  Signatur dieses neuen Builds, keine Notarisierung und keine Installation.**
  Build-Gate und Reise-/Remote-Go-Live bleiben AUSDRUECKLICH ROT.
- GitHub Source-/Fast-Gate von e0575c5 wurde erfolgreich.
- Neuem signiertem QA-Build erst eine separate Laufzeit-/Account-
  Isolation beibringen, bevor er neben Stage4J gestartet wird; der
  aktuell geerbte stage4j-qa-Feature-Namespace verwendet die bestehenden
  Stage4J-App-Support-/Keychain-Identitaeten und ist nicht als
  parallele eigenstaendige Runtime freigegeben.

### Naechster Review-Punkt

1. QA-Build-Performance isoliert untersuchen, dabei M2-Last und Disk pruefen.
2. Native Paketierung vollstaendig abschliessen, Developer-ID und externe
   Paketressourcen pruefen; keinesfalls vor vollstaendiger Pruefung starten.
3. Eigenstaendigen Stage4M-App-Support- und GUI-Singleton-Namespace fuer
   parallelen privaten Test entwickeln.
4. Erst danach signierte Client-QA auf M2, freigegebener M3-Test und
   authentifizierte Owner-/Mesh-/Agentenpruefung.
