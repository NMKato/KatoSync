# KatoSync 4.0 — Agent Birth & Activation / Release Roadmap

**Tracking-Epic:** https://github.com/NMKato/KatoSync/issues/224 · **Mesh-Abnahme:** https://github.com/NMKato/KatoSync/issues/152

**Entscheidungsdatum:** 04.11.2026 · **Status:** verbindliche Zielarchitektur und QA-Fahrplan, **kein Release** · **Owner:** KatoSync/NMKato Solutions.

## Produktentscheidung

**KatoSync 4.0** bezeichnet die erste vollständig integrierte Version aus **lokaler KI-Agentenlaufzeit, dauerhafter eigener Agentenidentität, nachweisbar sicheren Mesh-Kollegen, Projektgedächtnis und benutzbarem Orchestrator**. Die bisherige Stage-3.5-Reihe bleibt technisch notwendige Vorstufe. Die finale UI/UX-Politur ist die letzte Produktphase **nach** den funktionalen Sicherheits- und E2E-Gates, nicht deren Ersatz.

**Konkretes Nutzererlebnis:** KatoSync installieren → mit dem gemeinsamen KATOOS-Konto anmelden → einen lokal passenden KI-Modell- und Agentenpaket-Download auswählen und verifizieren → Agentenlaufzeit starten → Agent begrüßt den Eigentümer, erkennt erlaubte lokale Fähigkeiten, schlägt einen eigenen Namen vor und merkt ihn sich → entdeckt nach Opt-in weitere Instanzen → schickt eine Einladung („anklopfen“) → die Gegenstelle bestätigt bewusst oder verwendet eine **zuvor explizit eingerichtete, kryptografisch überprüfte Auto-Annahme-Richtlinie** → Agenten tauschen nach verifizierter Vertrauensstellung nur genehmigte Projektzusammenfassungen aus → geeignete Aufgaben laufen mit Bestätigung/Quittung verteilt.

Die „Geburt“ bezeichnet einen **persistenten Software-Agenten mit Modellfähigkeit**, kein menschliches Bewusstsein und keine Garantie für permanentes autonomes Verhalten. Ohne aktives Modell gibt es **keinen erwachten lokalen KI-Agenten**; technische Geräteerkennung und sichere Hintergrundregistrierung können trotzdem funktionieren.

## Verifizierter Ist-Stand (04.11.2026)

| Bereich | Verifiziert | Grenze |
|---|---|---|
| Tauri/Rust-App auf M2/M3 | Signierte, notarisierten Stage-3.5e-QA-Apps laufen mit gleicher Binary; Rollback vorhanden | Noch keine 4.0-App |
| Hardware und Schlüssel | Erkennung von CPU/RAM/Apple-Chip, Ed25519-Keychain-Key, konto-gebundene Gerätedaten | Hardwarefähigkeiten ≠ aktive Modellfähigkeit |
| KAI Nexus / KAI Nika | Namen werden **deterministisch aus Fingerprint + Plattform** gebildet | **Nicht** von Gemma/OpenClaw persönlich ausgewählt |
| Präsenz | Beide vorhandenen Stage35-Geräte haben signierte Cloud-Heartbeats bestätigt | Heartbeat ist kein LAN-Peer-Tunnel |
| Einladungen/Relay | Zwei angenommene QA-Einladungen; Challenge und Response über QA-Cloud übermittelt | 0 Server-Trusted; kein realer SAS/mTLS-/Remotejob-E2E |
| SAS-Freigabe | Stage35f-UI-Fix in Draft PR #223, Sicherheitsregeln getestet | Nicht in den installierten Stage35e-Bundles enthalten |
| Local Brain | Gemma-4-E4B-Manifest und llama.cpp-Installer vorhanden; M2-Modell GGUF und Vision-Projektor am 04.11. **SHA-256 und Größe exakt manifestkonform** geprüft | Stage35e nutzt diese Dateien **nicht**; Runtime-Binärdatei, Paketlizenz und sichere Import-/Startpfade noch abnehmen |
| OpenClaw | **Keine aktive/verpackte OpenClaw-Laufzeit im aktuellen Source-/Installationsstand nachgewiesen** | Integration, Prozesslebenszyklus und Rechte fehlen |
| M3-Installation | 16 GiB RAM/Apple M3 vorhanden | Wenig freier Speicher (ca. 8 GiB am Kontrollpunkt); vor Modellinstallation Speicherbudget prüfen |
| Kosten/Billing | Separater KatoSync-Pro-Produktentwurf (9,90 EUR/Monat, 14 Tage Karten-Trial, bis 10 Agenten) | Kein freigegebener Live-Billing-Checkout; Product-/Tenant-Isolation und Rechtstexte prüfen |

Quellen im Repo: `src-tauri/src/mesh_agent_bootstrap.rs`, `src-tauri/src/local_brain.rs`, `src/lib/localBrainManifest.json`, `docs/MEMORY_FABRIC.md`, `docs/KATOSYNC_STAGE35D_SIGNED_PRESENCE_2026-11-04.md`. QA-Tracking: Issue #152, Draft PRs #222 und #223. **Nicht als fertig melden, was nur geplant, modelliert oder per Unit-Test belegt ist.**

## 4.0.A — Agent Birth & Activation (P0, nächster Entwicklungsblock)

1. **Identität in zwei Ebenen trennen.** Ed25519-`device_identity` ist die unveränderliche technische Vertrauensbasis. `agent_persona` besitzt eine stabile lokale ID, eigene Rolle, Fähigkeiten, Namen, Geburts-/Aktivierungszeit, Modell-/Runtime-Version und explizite Eigentümerfreigaben. Benennung ändert keine Geräteidentität und keine Rechte.
2. **Vorübergehenden Namen ehrlich kennzeichnen.** Das heute deterministische „KAI Nexus/Nika“ ist ein technischer Platzhalter/Alias. Der Agent darf erst **nach** einer erfolgreichen lokalen Modellinferenz einen Namen vorschlagen, Nutzerwahl/Umbenennung erlauben, Duplikate und den reservierten Hauptnamen **REX** vermeiden. Nach Nutzerbestätigung lokal dauerhaft speichern; nach Restart/Upgrade unverändert wiederherstellen. Keine erneute Namensvergabe bei jeder Modellantwort.
3. **Fähigkeiten qualifiziert erkennen.** Native Hardware-Prüfung plus tatsächliche Modellprobe (Token-/Tool-Call-Smoke), verfügbare CPU/RAM/GPU, freier Speicher, Modellgröße, Netzwerk-/Batterie-/Schlafstatus. Eine Geräteklasse ist kein Beweis, dass ein Modell installiert oder ausführbar ist. Keine Hardware-Seriennummer als Cloud-Quota-Mechanismus.
4. **Gemma-4-E4B-Paket über bestehendes Local-Brain-Manifest einbinden.** Erst Download-Lizenz-/Redistribution-/Notice-Gates, freie Platte, erwartete SHA-256/Größe, Version und signierten Runtime-Pfad prüfen. Bereits lokal vorhandenes M2-Modell **nur nach Integritätsprüfung** wiederverwenden, ohne Keychain-/App-Isolation zu durchbrechen. Auf M3 zunächst Speicher freimachen; Download nie automatisch erzwingen. Fallback auf geeignete kleinere lokale Modelle planbar, nicht stillschweigend.
5. **Agentenlaufzeit kontrolliert integrieren.** OpenClaw als zu überprüfendes Framework (Version, Lizenz, Lieferkette, Sandbox, Update/Uninstall, macOS/Windows-Kompatibilität), mit lokalem Gemma über llama.cpp als LLM-Provider. Per-Tool-Berechtigungen, Timeouts, Stop/Resume, Fehlergrenzen und Audit-Logs; keine unbeaufsichtigten Shell-/Git-/Cloud-Schreibaktionen allein aufgrund von „Agent erwacht“.
6. **Einmalige Birth-Transaktion.** State-Machine:
   `registered` → `model_requested` → `package_verified` → `runtime_ready` → `birth_pending` → `persona_confirmed` → `awake` / `dormant` / `error`. Der Owner kann Installation/Birth abbrechen, erneut starten und den Agenten entfernen. Idempotent bei Crash, Neustart, App-Upgrade und Offline-Betrieb.
7. **Eigene lokale Memory-Sphäre.** Per-Agent episodenbezogenes, begrenztes Gedächtnis + Verweise auf die vorhandene projektgebundene Memory Fabric. Nur verifizierte/quellengebundene Projektdaten werden als Tatsachen übernommen; eigene Modellideen sind `observed`. Kein ungefragtes Teilen von Chatverläufen, Dateipfaden oder API-Credentials. Owner kann einsehen, exportieren, bereinigen und löschen.

**Abnahme A:** Auf M2 und M3 startet je ein signiertes Produktpaket nach kontrollierter Modellinstallation eine echte lokale Inferenz samt erlaubtem Tool-Call, erzeugt/übernimmt exakt eine bestätigte Persona, bewahrt sie nach zwei Neustarts und App-Update, funktioniert offline, respektiert Cancel/Uninstall und meldet ehrlich `dormant`, wenn das Modell nicht aktiv ist.

## 4.0.B — Agenten finden, ankündigen, beitreten (P0)

1. Nach einem verifizierten KATOOS-Login und Owner-Opt-in nur same-account-Geräte entdecken; den Cloud-Heartbeat als **letzten Kontakt**, nie als verbindliche „online“-Garantie darstellen. LAN/P2P-Discovery nur mit entsprechenden OS-Berechtigungen.
2. Der erwachte Agent sendet eine signierte kurze Einladung mit begrenzten öffentlichen Informationen: Rufname, Public-Key-Fingerprint, freigegebene grobe Fähigkeiten, Ablaufzeit. Remote-Einladungen im Postfach anzeigen, Spam/Rate-Limits und Blockliste.
3. **Auto-Annahme** ist optional, vom Owner konfigurierbar und **nur für zuvor kryptografisch gepinnte oder owner-autorisiert vorab bestätigte Geräte**. Für unbekannte Erstkontakte bleibt Passkey-/SAS-/Owner-Freigabe erforderlich. Gleicher Account, Name oder Hostname genügt nie für Trust.
4. Auf beiden Seiten Challenge/Response + SAS/Keychain-Pin und Widerruf testen; danach erst TLS 1.3/mTLS über echten Netzwerktransport, Peer-Pinning, Reconnect und unabhängige On-/Offline-Anzeige.
5. Nach beidseitig bestätigt gesichertem Transport **genau eine** signierte Begrüßung, anschließend höchstens drei explizit freigegebene Projektkurzstände. Wiedereinstiege sind idempotent, ohne automatische Preisgabe interner Memory-Inhalte.

**Abnahme B:** Zwei echte Macs gleichen **frische** SAS-Codes lokal ab, speichern beidseitig nur öffentliche Peer-Keys, widerrufen einen davon zuverlässig, starten eine echte gegenseitig authentifizierte Verbindung und quittieren die erlaubte einmalige Begrüßung. Signierte Relay-Nachrichten allein zählen nicht.

## 4.0.C — Autonome Zusammenarbeit / Orchestrierung (P0)

- Lokale Agenten wählen bei freigegebenen Tasks Modell- und Werkzeugkategorie anhand **tatsächlicher** Fähigkeiten/Ressourcen statt nur CPU-Namen; Codex/Claude-Quoten-Fallback darf nur kompatible Aufgaben übernehmen.
- Ein verifizierter kleiner Remote-Read-only-Job M2 ↔ M3 mit Request-ID, Signatur, Empfänger-/Rechtebindung, Timeout, Retry, Idempotenz und bestätigter Ergebnis-Quittung. Fehler/Funklöcher/Schlafzustände dürfen keine Doppeljobs oder Endlosschleifen erzeugen.
- Schreibende Arbeiten erst nach eigener Task-Freigabe, Single-Writer-Lease/Fencing und Widerrufsprüfung (**Issue #76**). Keine automatische Main-Merges, Deployments, THEORG-Änderungen oder Geheimnisweitergabe.
- Hintergrundbetrieb mit kontrolliertem Ressourcenbudget: **kleiner Agenten-/Watchdog-Prozess läuft ohne dauerndes 4–6-GB-Modell im RAM**. Wake-on-demand nur bei zulässigem Energiestatus und verfügbarer Runtime; echte Geräte im Schlaf sind nicht kontinuierlich erreichbar.

**Abnahme C:** Ein genehmigter Auftrag wird auf beiden echten Macs einmalig ausgeführt und quittiert; er kann abgebrochen, erneut zugestellt und unterbrochen werden, ohne Sicherheits-/Idempotenzbruch. Unautorisierte Schreibaufträge werden nachweislich verweigert.

## 4.0.D — UX / Release Polish (P1, nach A–C)

- Moderner, ruhiger Light-/Dark-Mode, Glasoptik mit Kontrast, einheitliche Typografie und skalierbares Layout; klare Bereiche **Geräte**, **Agenten**, **Einladungen**, **Jobs**, **Memory**, **Lokales Modell**. Keine kryptischen IDs als primäre Namen.
- Ein begleiteter Einrichtungsfluss: Hardwarecheck → Platz-/Lizenzprüfung → Modellpaket → „Agent erwacht“ → Persona-Namensvorschlag → Datenschutz/Autonomieprofil → sichere Kollegen-Einladung.
- Kosten-/Status-Klarheit: installiert/ausgeschaltet/erwacht/zuletzt gesehen/gekoppelt/online/arbeitet sind verschiedene Zustände. Kostenlos/Pro bis 10 Geräte verständlich, QA-Doppelidentitäten nicht als physische Rechner abrechnen.
- DE/EN/RU/ES und später GE/TR, VoiceOver/Tastatur, Fehlermeldungen, Upgrade-/Revoke-/Reinstall-Dialoge, Wiederaufnahme nach Crash, verständlicher Geräte-/Speicherverbrauch.

## 4.0.E — Harte Release-Gates für KatoSync 4.0 (GO / NO-GO)

| Gate | Abnahme | Stand 04.11.2026 |
|---|---|---|
| Local Brain | Modell-Lizenz/Hashes/Storage und echte lokale Inferenz auf M2/M3 | **Offen** |
| OpenClaw-/Tool-Laufzeit | echte kompatible, sicher sandboxed Agenten-Tasks, Restart/Stop/Logs | **Offen** |
| Persona/Memory | Einmalige Modell-gestützte Namenswahl, dauerhafte Identity & Evidence-Provenance | **Offen** |
| Mesh | Owner-SAS auf beiden Macs, echte mTLS-Verbindung, Widerruf, Hello | **Offen** |
| Jobs | signierter read-only Remote-Job inkl. Idempotenz, Writer-Lease vor Writes | **Offen** |
| Lizenz/Billing | KatoSync-eigene Stripe-/DB-Scopes, Free 0 Mesh / Pro 10, 14-tägiger Kartentest, Storno/Verbraucherpflichten | **Offen** |
| Qualität | Node/Rust/TS, macOS M2+M3, Windows Installer, Offline/Crash/Netz, Rollback/Notarization | **Teilweise** |
| Produkt | Accessibility, UX-Polish, lokalisierte Texte, Datenschutz/Sicherheit, P0/P1-Fehler Null | **Offen** |

**Release-Regel:** 4.0 wird erst freigegeben, wenn alle P0-Gates auf *realen Installationen* mit Prüfbelegen grün sind, nicht nur Unit-Tests. Unfertige Funktionen bleiben klar als Beta/Preview markiert; keine erfundenen Fortschrittsprozente oder Liefertermine.

## Wirtschaftlichkeit und Systemgrenzen

- Jeder Kunde trägt die Kosten seiner eigenen externen Modell-Provider. Lokale Inferenz nutzt die Hardware des Kunden; KatoSync bezahlt nur kontrollierte Cloud-Sync-/Koordinationskosten.
- Cloud-Heartbeat grob/gedrosselt; nach sicherer Kopplung P2P-first und begrenzte Cloud-Relay-Nachrichten. Keine dauerhaft teuren cloudgehosteten Modelle für jede Agenten-Persona.
- Maximal 10 Pro-Agenten/Workstations erfordern **serverautorisierte Kontingentlogik**. Test-Installationen mit getrennten Keychain-Scopes bleiben eigene kryptografische Instanzen; Hardware-Zusammenführung nicht anhand spoofbarer Hostnamen.
- OpenClaw und Gemma sind eigenständige Komponenten mit eigenen Lizenzen und Release-Anforderungen; Repackaging/Redistribution erst nach gesonderter Freigabe. Kein automatischer Download großer Modelle bei knappem Speicher.

## Unmittelbare Reihenfolge und Übergabe

1. Stage35e/f kontrolliert integrieren und echten SAS-Trust abnehmen; bestehendes **Issue #152** und Draft-PRs #222/#223 weiterführen.
2. **Epic #224 Agent Birth & Activation angelegt.** Die erste technische Prüfung ist **bestanden**: M2-Bestandsmodell 4.590.807.392 B und Vision-Projektor 559.874.816 B stimmen in SHA-256 und Größe exakt mit dem Manifest überein. Nächste Aktion ist die sichere, nur lesende Runtime-/Lizenz-Prüfung und eine isolierte Wiederverwendung ohne Manipulation der vorhandenen Dateien.
3. Für M3 freien Speicher vor Modellpaket sicherstellen (mindestens Modell + Runtime + Staging + Betriebssystemreserve). Keine Installation, bis der Platz nachgewiesen ist.
4. Danach die OpenClaw-Laufzeit als separaten, austauschbaren, versionsgepinnten und sicher eingeschränkten Adapter mit einem einzigen echten lokalen Tool-Call abnehmen.
5. Sobald A–C nachgewiesen sind: UI-Polish, Release-Kandidaten, vollständige Sicherheits-/Billing-/Plattformabnahme, 4.0-Freigabe.

**Dateien/Referenzen:** private operator `PROJECT_STATUS_FLOW.md` / `MEMORY.md` werden lokal weitergeführt und bleiben ausdrücklich **gitignored**; diese Datei enthält nur veröffentlichungsfähige technische Roadmap-Informationen. Memory-Vorgaben: `docs/MEMORY_FABRIC.md`. Niemals Secrets, private Projektinhalte oder personenbezogene lokale Pfade in öffentliche PRs übernehmen.

## Ergänzung vom 04.11.2026: Runtime out-of-box, One-Click-Setup und Desktop-Widget

**Tracking:** https://github.com/NMKato/KatoSync/issues/226.

**Verbindliche Produktanforderung:** Der KatoSync-4.0-Installer soll eine für das Zielgerät verifizierte llama.cpp-Runtime **inklusive der dynamischen Bibliotheken und zugehörigen Lizenz-/NOTICE-Dateien** bereits enthalten. Nur die großen, auswählbaren lokalen Modellgewichte werden nach einem ausdrücklichen Klick auf **„Setup starten“** bezogen. Bereits vorhandene, hashverifizierte Modelle sollen ohne unnötiges erneutes Herunterladen wiederverwendbar sein.

**Onboarding-Flow:** `hardware_and_disk_checked` → `explicit_download_approved` → `download_resumable` → `sha_verified` → `model_installed` → `local_alias_health_verified` → `ready_for_agent_birth`. Eine echte Agenten-Persona mit eigenem Namen gibt es **erst nach** erfolgreicher lokaler Modell-/Tool-Inferenz sowie Owner-Bestätigung. Ein fehlgeschlagener Start darf keine Erfolgsmeldung erzeugen. Der Installer muss Abbruch, Netzwerkverlust und Rechnerneustart wiederaufnehmbar behandeln.

**Hintergrundbetrieb:** Nach bestätigtem Setup kann der Nutzer das Hauptfenster ausblenden. Ein leichter Controller und das Widget bleiben erreichbar; das große Modell wird nur bei Bedarf geladen. Erst ein verlässlich funktionierender Wiederöffnungsweg (Widget, Tray/Menüleiste oder Dock) erlaubt automatisches Minimieren. Keine versteckte permanente RAM-/Batterielast.

**Desktop-Widget ist P0 für 4.0**, nicht nur optionaler UI-Polish: frei beweglich, lokal positionstreu, im Hintergrund anklickbar, aktuelle verifizierte Job-/Warteschlangen-/Agenten- und Modellzustände, Schnellauswahl Jobs/Chat/Agenten, „Mehr“ öffnet die passende KatoSync-Seite. Bei fehlender/alter Berichterstattung `stale` statt falschem `online`. Jobtitel und private Projektinformationen standardmäßig ausgeblendet, nutzerbestätigte Detailfreigabe; opt-in bei Login/Always-on-top und Barrierefreiheit.

**QA-Slice:** eigener Branch `feat/katosync-v40-setup-widget-20261104`. Tauri-Fenster und gebundene read-only Statusprojektion mit Tests implementiert; opt-in Schalter `VITE_KATOSYNC_DESKTOP_WIDGET_QA=1`. Der Bundle-Runtime-Resolver und ein offline prüfender, per Lizenzfreigabe gesperrter Release-Packager sind vorbereitet. **Noch nicht** als installierte/neusignierte 4.0-App auf M2/M3 abgenommen; Runtime noch nicht als reguläres App-Resource-Paket ausgeliefert. Weitere Release-Gates: vollständiger notarisiert signierter Bundle-Build, Windows-Variante, Status im echten Hintergrund und Position nach Monitorwechsel, offene OpenClaw-Integrierung, UI/UX-Polish.

Details: `docs/KATOSYNC_4_0_SETUP_RUNTIME_DESKTOP_WIDGET_2026-11-04.md`.
## 04.11.2026 – Smart Project Flow & ETA als zusätzlicher 4.0-Releasebaustein

Die bestätigte Produktidee umfasst einen klar erklärten **Roadmap-/Repository-/Statusdatei-Fortschrittsbalken**, die aktuell arbeitende Lane und ihren Job, echte GitHub-CI- und Testbelege, nächste offene Roadmap-Aufgaben und optional eine **datenbasierte Abschlussprognose als Zeitraum**. Tracking: https://github.com/NMKato/KatoSync/issues/229.

Neue Implementierung im isolierten Draft-Zweig `feat/katosync-v40-smart-project-progress-20261104`: `smartProjectProgress40` und `ProjectProgressIntelligence40` sind in das registrierte Agent-Sync-Projektportfolio eingebunden. Der gewichtete Status ist als **gemeldet, nicht abgenommen** markiert. Repo-/Dokumentkonsistenz und tatsächliche zeitlich aktuelle Arbeit werden separat dargestellt. Eine Prognose setzt mindestens drei unabhängige historische Feature-Abnahmen und stabile Arbeitsgeschwindigkeit voraus; ohne Akzeptanzhistorie wird kein geschätztes Datum angezeigt. Nach Source-/Git-/Roadmap-Änderung darf eine alte ETA nicht weiterverwendet werden.

**Wichtige Ergänzung:** Die Prognose muss auch erklären, *welche Blocker den Release verschieben*, und ihre Quellen und Unsicherheiten offenlegen. Nicht jeder Commit, jedes grüne GitHub-Workflow oder jedes `running`-Flag ist ein Nachweis echten Arbeitsfortschritts. Das Native-Backend liefert heute noch `verifiedPercent=null`; bis ein durch Git-/CI-/Owner-Abnahme gesichertes Acceptance Ledger existiert, bleibt die reale ETA ausdrücklich **nicht verfügbar**.

Details/Tests und nachfolgende Gates: `docs/KATOSYNC_4_0_SMART_PROJECT_FLOW_FORECAST_2026-11-04.md`. Der neue Smart-Flow-Slice ist vorerst nur im Entwickler-Worktree, **nicht** in den laufenden signierten Stage35e-Apps installiert. KatoSync ist für beaufsichtigte Projektüberwachung nutzbar; für ein autonomes 4.0-Release sind Agent Birth, direktes verifiziertes Mesh, Jobs, Billing und Plattform-QA weiterhin P0.
