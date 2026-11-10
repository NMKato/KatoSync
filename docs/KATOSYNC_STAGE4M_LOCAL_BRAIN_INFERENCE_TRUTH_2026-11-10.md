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
