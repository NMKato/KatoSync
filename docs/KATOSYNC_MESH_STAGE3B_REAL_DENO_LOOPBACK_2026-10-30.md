# KatoSync Mesh Stage 3B — echte Deno-HTTP-Laufzeit ohne Supabase-Cloud

**30. Oktober 2026.** Aufbauend auf [Stage 3A, Draft-PR #193](https://github.com/NMKato/KatoSync/pull/193). Ziel: Nachweis, dass die unveränderten Edge-Handler **in Deno tatsächlich über HTTP reagieren**, statt nur über den simulierten `Deno.serve`-Shim in Node.js ausgeführt zu werden.

## Durchgeführte lokale Ausführung

Auf dem M3 (Apple Silicon, externe Entwicklungs-SSD) wurde **Deno 2.9.6** aus dem offiziellen npm-Paket in einem **isolierten QA-Werkzeugverzeichnis** installiert. Keine globale Installation, keine Supabase-Cloud-Ressource, keine Änderung an KATOOS, keine aktiven Mesh-Freigaben. Zusätzlich musste die ARM64-`esbuild`-Binärabhängigkeit im isolierten Projekt installiert werden; der systemweite npm-Cache hatte einen Berechtigungsfehler, deshalb wurde hierfür ein eigener QA-Cache auf der Entwicklungs-SSD verwendet. Es wurden **keine Systemrechte** geändert.

Reproduzierbarer Aufruf:

```bash
node scripts/qa-mesh-deno-loopback.mjs --synthetic-loopback \
  --deno-bin /ABSOLUTER/PFAD/ZU/QA-DENO-BINARY
```

Ohne alle Parameter verweigert das Skript vor Start des Servers die Ausführung. Die M2- und M3-Produktion-App bleibt unberührt.

## Vertrauensgrenzen

1. Vor dem Start verifiziert der bereits bestehende Stage-2W-Checker **alle vier SHA256-gepinnten SQL-Migrationen, alle fünf relevanten Edge-Quelltexte** und bündelt beide Original-`index.ts`-Einstiegspunkte mit ihren echten Imports.
2. Ausschließlich die **Server-Listener-Konfiguration** der erzeugten QA-In-Memory-Bundles wird von `Deno.serve(handler)` auf `Deno.serve({hostname:"127.0.0.1",port:<dynamischer Testport>}, handler)` umgeschrieben. Der ursprüngliche Handler und sämtliche Produktionsdateien bleiben unverändert; dies ist keine unverändert binäre Edge-Deployment-Probe.
3. Der echte Deno-Prozess läuft mit `--no-prompt`, `--no-remote`, lediglich `--allow-net=127.0.0.1:<einziger Testport>` und `--allow-env` nur für fünf bekannte Serverkonfigurationsnamen. **Keine Datei-, Prozess-, FFI-, Remote-Modul- oder externe Netzwerkberechtigung.** Node sendet HTTP-Requests an den tatsächlichen lokalen Deno-Server. Alle verwendeten Server-Keys und Bearer-Werte sind rein synthetisch.
4. Jeder der beiden Dienste wird in vier voneinander getrennten Prozessen getestet: **Stage-Flag aus**, **falsches Stage-Flag**, **Stage-Flag an/Server-Secret fehlt**, **Stage-Flag an/alle Werte synthetisch**. Die ersten drei Varianten liefern `503 INBOX_NOT_CONFIGURED` und `Cache-Control: no-store`. Im letzten Fall werden ohne echten Datenbank-/Netzwerkzugriff `GET → 405 METHOD_NOT_ALLOWED`, `POST ohne Authorization → 401 LOGIN_REQUIRED`, `POST mit synthetischem Bearer und falschem JSON → 400 BAD_INVITE/BAD_PROOF` geprüft.
5. Die temporären Bundles, die QA-Deno-Caches und alle Prozesse werden bei Erfolg oder Fehler beendet bzw. entfernt. Kein Cloud-Deployment und keine Gebühren.

Tatsächlich bestanden: **8 von 8 eigenständigen Deno-Prozessszenarien**, beide echten HTTP-Handler antworteten mit den erwarteten Fehlercodes. Zusätzliche **vier plattformneutrale Node-Contracttests** stellen sicher, dass keine stillschweigende Deno-Installation, unbefugte Startfreigabe, permissive Netzwerkberechtigungen oder falsche Ergebnisdeklarationen hinzukommen.

## Nicht nachgewiesen

- **Supabase Edge Runtime ≠ Standalone Deno**: Supabase CLI und Cloud verwenden eine eigene Edge Runtime mit Gateway, nicht exakt diesen Deno-Prozess. Für authentifizierte Cloud-Requests fehlen weiterhin die isolierte Testumgebung, Gateway-JWT-Validierung, echtes Auth-/PostgREST-Verhalten und der Origin-/Claim-Austausch.
- Kein tatsächlich beidseitig bestätigtes M2↔M3-Keychain-SAS-/mTLS-Pairing, kein echter vertrauenswürdiger Peer und keine Remote-Jobs. Der Produktions-Release-Lock bleibt unverändert.
- Keine neue kostenpflichtige Supabase-Branch-Umgebung; die Stage3A-Offlinetests sind weiterhin die einzige Cloud-unabhängige sichere Ausführungsvariante.

Nächster Freigabepunkt: Kosten-/Operatorentscheidung für einen isolierten Supabase-QA-Branch **ohne** reale KATOOS-Daten, Cron-Jobs oder Netzwerknebenwirkungen. Danach echter JWT- und PostgREST-Edge-E2E in der Supabase-eigenen Laufzeit. Bis dahin Mesh-Inbox-Funktionen auf Live nicht deployen.
