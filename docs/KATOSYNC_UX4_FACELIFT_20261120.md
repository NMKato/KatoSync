# KatoSync 4.0 – Agent Sync UX Facelift, privater Designkandidat

Created by NMKato Solutions · 20. November 2026

## Freigegebene visuelle Richtung

Die bestätigte Designvorlage besteht aus einem ruhigen Light-Default mit Dark- und Auto-Modus, klarer vertikaler Navigation und kompakten Card-Grids. Der Modusschalter **Mistral / Agent Sync bleibt unverändert**. Agent Sync wird als eigenes KI-Kontrollzentrum dargestellt, ohne Mistral-Workflows umzuinterpretieren.

- Primäre Verbindungskarten: **Codex, Claude, lokale KI, Local Control/RDC**, mit vorhandenen provider-/runtimebezogenen Zuständen.
- Integrationskacheln: **Geräte-Mesh, ChatGPT MCP, GitHub**, optisch sekundär und nicht automatisch autorisiert.
- Drei kompakte Übersichtskarten für **Geräte, Client-Freigaben und registrierte Projekte** kommen aus vorhandenem ViewModel/Mesh-Kontext. Unbekannte MCP-Rechte bleiben **unbestätigt**.
- Onboarding zeigt vier technisch beobachtbare Meilensteine: Kontoanmeldung, verbundener Cloud-Provider, **Mesh**-Peer-Verbindung und registriertes Projekt. Diese Schritte sind **nicht** identisch mit persönlicher Authenticator-/MCP-Client-/Device-Zustimmung und ersetzen deren Gate nicht.
- MCP-Rechte werden im nativen Owner-MFA- und Device-Review-Flow gesondert freigegeben; das UI stellt sie nicht eigenmächtig als abgeschlossen dar.
- 3D-Hover-Akzente bleiben auf wenige Pixel und geringe Schatten beschränkt; Reduced Motion schaltet die Effekte ab.

## Theme und Versionstransparenz

- Erster Start ohne gespeicherte Theme-Präferenz: **Hell**.
- Vorhandene explizite Theme-Präferenzen bleiben erhalten. **Auto** folgt dem laufenden System-Farbschema über Media-Query-Listener.
- Agent-Sync-Fußzeile: **KatoSync 4.0 · UX Beta**. Das ist die **Designvorschau**, nicht eine bereits veröffentlichte native 4.0-Semver. Native App, Signierung und Produktfreigabe bleiben separat gated.
- Logout, Quit, Sicherheitsregeln und Mistral-Modus bleiben unverändert.

## Verifikation

- Der Entwicklungszweig basiert auf der verifizierten C12-Quelle 88fe28fd0908c5fe6cc715342a2512eb3fa3cdee und bleibt von Candidate 11 isoliert.
- Der neue Contract-Test tests/agentSyncFacelift40.test.ts prüft Navigation, Mode-Schalter, Theme-Auto, Login-/Provider-/Mesh-/Projekt-Wahrheit, Default-Deny bei MCP-Rechten, Kartenlayout und Reduced Motion.
- Die Browser-QA nutzt echte React-View-Komponenten mit **synthetischen, ausdrücklich markierten** Daten. Geprüfte Fenstergrößen: 1240/1040/720/390 px, DE/EN/RU/ES, Light/Dark, lokale Logos, sieben Kacheln, vier Onboarding-Punkte, drei Übersichten, keine externen Requests oder implizite Freigabe.
- Anzeigen belegen keinen tatsächlichen Gerätetransport oder MCP-E2E. Ein Installer ist erst nach finaler TypeScript-, Browser-, Native-WebKit-, Signierungs- und M2/M3-Praxisabnahme freizugeben.
- Auf M2 bestehen hohe CPU-Last und wenig interner Freispeicher. Candidate 11 nicht überschreiben; keine schweren nativen Installationspakete ohne vorherigen Speicher-/Ressourcencheck.

## Sicherheits-/UI-Scope

Keine Änderung an Rust/Tauri-IPC, Owner-Berechtigungen, Supabase, Cloudflare-Gateway, JWT, Geräte-Trust, Secret-Storage, Mesh-WSS, CLI-Ausführung oder Projekt-Schreibberechtigungen. Keine simulierten grünen Online-Zustände, kein künstlicher 3-von-4-Onboarding-PASS und keine erfundene Projektaktivität.

## Abnahme-Checkpoint: tatsächliche Quellen- und Browserläufe

- Vollständige Node-Regression: **1035/1035 PASS**, 0 Fehler, 0 Skips.
- Gezielt wiederholte Facelift-/Provider-/Vision-/Mesh-Verträge: **28/28 PASS** nach den letzten UI-Korrekturen.
- TypeScript: **npm run typecheck, Exit 0**.
- Vite: **Exit 0**, 1933 Module transformiert, CSS/JS-Bundles erfolgreich erzeugt. Haupt-JS ca. 1,43 MB; bekannte nicht-blockierende Code-Splitting-Warnung.
- Isolierte Browser-Szenarien: **4/4 PASS** (DE/Dark/1240, EN/Light/1040, RU/Dark/720, ES/Light/390), 7 echte Verbindungskacheln, 4 Daten-gesteuerte Onboarding-Schritte, 3 Summaries, 0 externe Netzwerkaufrufe, 0 unbeabsichtigte Freigabeaktionen, keine Browserfehler oder horizontalen Überläufe. Zwei zentrale Screenshots (DE/Dark und EN/Light) manuell betrachtet.
- Git-Diff ohne native/Cloud-/Datenbank-/Paketkonfigurationsänderungen. Das Live-MCP-Client-/Device-E2E und die tatsächliche macOS-WebKit-/Windows-Paketabnahme bleiben gesonderte Gates.
- **Kein neuer Installer und keine auf M2/M3 installierte 4.0-App durch diese Quellabnahme**. C11 bleibt unangetastet. Eine GUI-Mockup-Visualisierung ist keine Live-Statusquelle.
