# KatoSync – UX Cockpit / Teilabnahme C12 (20.11.2026)

Created by NMKato Solutions

**Status: Entwicklungszweig, kein neues signiertes App-Paket und kein 4.0-GO.** Ausgangspunkt ist die auf M2/M3 geprüfte private Candidate-11-Beta (Commit `3ddd71e`). Dieser Arbeitsschritt verbessert ausschließlich Navigation, Darstellung und die Zuordnung lokaler Markenassets. Die installierte Beta wird hier nicht überschrieben.

## Umgesetzt

- Drei Kernansichten (Übersicht, Verbindungen, Vision) sofort sichtbar; zusätzliche Agent-Sync-Bereiche werden unter **Weitere Bereiche** eingeklappt. Die vorhandenen Step-Handler bleiben bestehen.
- Sprache, Präsentationsmodus und Nutzungsvereinbarung wandern in das einklappbare Menü **Anzeige und Einstellungen**. Die Konto- und Programmaktionen verbleiben separat.
- Fünf grafische Navigationskacheln für SmartMesh, ChatGPT MCP, OpenAI Codex, Claude Code und lokale KI. Die Kacheln scrollen zu den bestehenden sicheren Karten; sie führen keine Anmeldung, Freigabe oder Modellaktion aus. Providerstatus wird aus den vorhandenen Statuswerten abgeleitet.
- Vision zeigt lokale OpenAI-/Anthropic-Markenassets auf den tatsächlichen `lane:codex`- bzw. `lane:claude`-Knoten. Andere Knoten behalten ihre bisherigen Symbole. Ohne vorhandene Lane wird kein Provider-Knoten erfunden.
- Einheitliche 44px-Trefferflächen, dunkle/helle Glaskarten, klare Fokusumrandungen, responsives Mehrspaltenraster und reduzierte Animationen bei `prefers-reduced-motion`.

## Noch nicht implementiert / getrennt zu verifizieren

1. Durchgängiges geführtes Connection-Onboarding mit Login-Popups und expliziten, einmaligen Geräte-/Clientfreigaben. Keine stillen Autorisierungen.
2. Telemetrie-Zeitreihen und Graphen über Ressourcen, Lastspitzen, Git-Pushes, Latenz und Provider-Fallback. Erst nach quellengebundener Zeitstempel-/Metrikerfassung und Aufbewahrungskonzept; keine simulierten Produktionsdaten.
3. Offline-Watchdog: signierter, projektgebundener Lesesnapshot/Index und eventbasierte Aktualisierung ohne permanentes LLM; bedarfsgerechter lokaler Modellstart nur nach RAM/CPU/Batterie/Leistungsbudget; überprüfter Rückwechsel zum Cloud-Provider. Keine stillen Schreib- oder Push-Aktionen.
4. Agenten-Persona-/Namenswahl nach echter Modellinferenz und Owner-Bestätigung. Der aktuelle Gerätealias ist eine technische Kennung und keine autonome Benennung.
5. Echte ChatGPT-MCP-Gerätebefehle, Projektfreigabe, erster read-only Job mit Quittung, direkter LAN-Test, M3-Inferenz, Windows-Abnahme, OpenClaw-Tool-Sandbox, Writer-Lease, Offline- und Crash-Gates. Siehe `README.md` und `docs/KATOSYNC_4_0_AGENT_BIRTH_RELEASE_ROADMAP_2026-11-04.md`.

## Kurzer manueller Testplan auf einem später signierten C12-Kandidaten

1. **Navigation:** Agent Sync öffnen. Übersicht, Verbindungen und Vision direkt wählen; „Weitere Bereiche“ öffnen, Jobs/Chat/Projekte/Einstellungen testen. Bei 1040×720 prüfen, dass nichts abgeschnitten wird und die Fußzeile nicht überlappt.
2. **Anzeige:** „Anzeige und Einstellungen“ öffnen, Sprache DE/EN/ES/RU, Light/Dark und Präsentationsmodus prüfen. Menü mit Tastatur bedienen. Nutzungsvereinbarung anzeigen und wieder schließen.
3. **Verbindungskacheln:** Alle fünf anklicken. Sie müssen zu vorhandenen Karten führen. Bei bereits verbundenem Provider keine erneute Anmeldung; bei fehlender Anmeldung nur bisherige explizite Login-Schaltfläche. Gerätefreigaben bleiben unverändert.
4. **Vision:** OpenAI/Anthropic bei tatsächlich vorhandenen Provider-Lanes erkennen; Knoten aufrufen, Verbindungen und die zugehörigen Projektdetails kontrollieren. Fehlende/offline Provider dürfen nicht als verbunden erscheinen.
5. **Mesh:** Zwei Macs verbinden, App auf einem Mac normal neu starten und beide „Verbunden“-Status erneut überprüfen. Keine Freigabe oder Schriftänderung ohne eigene Bestätigung.
6. **Local Brain:** Auf M3 bei zu geringer Reserve nur verständlichen Schutzstatus erwarten; Cloud-Codex darf weiter nutzbar sein. Auf M2 Start und echte Inferenz testen. Offline-Verhalten nicht als bestanden ausgeben, bevor Internet-/RAM-Ausfall bewusst getestet wurde.
7. **Sicherheit:** Login/Logout/Client-Revoke und Statusanzeige testen; unbekannte Geräte brauchen weiterhin Freigabe. Kein automatischer Job, Commit oder Push beim Navigieren.

**Freigabekriterien:** TypeScript- und Anwendungstests grün, visuelle/native Prüfung beider Themen und Bildschirmgrößen, GitHub/README dokumentiert, eigene Signatur- und notarisiertes Installationspaket vor Übernahme der laufenden Beta. Die Designstufe allein ist keine 4.0-Releasefreigabe.
