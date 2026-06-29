// Deutsche Quell-Texte (Single Source of Truth). Andere Sprachen fallen bei fehlendem Key auf Deutsch zurueck.
// Platzhalter im Format {name} werden von t() interpoliert.
const de = {
  // Navigation
  "nav.dashboard": "Dashboard",
  "nav.actionQueue": "Action Queue",
  "nav.projectBoard": "Projekt-Board",
  "nav.briefings": "Briefings",
  "nav.settings": "Einstellungen",
  "nav.logs": "Aktivitäten",

  // Seiten-Kopf (Titel + Untertitel)
  "page.dashboard.title": "KatoSync",
  "page.dashboard.text": "Dashboard für Sync, Uploadplan, Action Queue und aktuellen Status.",
  "page.actionQueue.title": "Action Queue",
  "page.actionQueue.text": "Agent-Pläne lokal prüfen, freigeben oder ablehnen. Es wird nichts automatisch ausgeführt.",
  "page.projectBoard.title": "Projekt-Board",
  "page.projectBoard.text": "Freigegebene Aufgaben pro Projekt einplanen, sortieren und sequenziell an Codex übergeben.",
  "page.briefings.title": "Briefings",
  "page.briefings.text": "Mistral-Ergebnisse lesen, priorisieren und für die lokale Umsetzung vorbereiten.",
  "page.settings.title": "Einstellungen",
  "page.settings.text": "Mistral, MCP, Gerätekennung, Sync-Regeln und lokale Runner-Verbindungen gebündelt.",
  "page.logs.title": "Aktivitäten",
  "page.logs.text": "Protokolle, Hinweise und letzte Entscheidungen an einem Ort.",

  // Sidebar-Fußzeile + Sprachschalter
  "sidebar.presentation": "Präsentationsmodus",
  "sidebar.presentationOn": "Präsentationsmodus an",
  "sidebar.presentationTitleOn": "Präsentationsmodus aus (Daten wieder sichtbar)",
  "sidebar.presentationTitleOff": "Präsentationsmodus an (sensible Daten maskieren)",
  "sidebar.license": "Nutzungsvereinbarung",
  "sidebar.quit": "Programm beenden",
  "sidebar.languageTitle": "Sprache wählen",
  "topbar.save": "Einstellungen speichern",
  "topbar.unsavedHint": "Du hast ungespeicherte Änderungen. Übernimm sie mit „Einstellungen speichern“.",
  "lang.de": "Deutsch",
  "lang.en": "Englisch",
  "lang.es": "Spanisch",
  "lang.ru": "Russisch",

  // Cockpit
  "cockpit.title": "Cockpit",
  "cockpit.live.idle.title": "Alles ruhig",
  "cockpit.live.idle.text": "Aktuell läuft kein Lauf. Starte einen Sync oder gib eine Aufgabe an Codex.",
  "cockpit.live.codex.title": "Codex läuft",
  "cockpit.live.codex.events": "{count} Ereignisse im Live-Feed …",
  "cockpit.live.codex.running": "Aufgabe wird auf eigenem Branch ausgeführt …",
  "cockpit.live.queue.title": "Projekt-Queue läuft",
  "cockpit.live.queue.task": "Aufgabe wird abgearbeitet …",
  "cockpit.live.queue.active": "Warteschlange aktiv …",
  "cockpit.live.ready.title": "Bereit",
  "cockpit.live.readyHints.title": "Bereit (mit Hinweisen)",
  "cockpit.live.ready.text": "Letzter Lauf: {uploads} Uploads, {errors} Fehler, {warnings} Warnungen.",
  "cockpit.next.title": "Nächster geplanter Lauf",

  "cockpit.section.tasks": "Aufgaben gesamt",
  "cockpit.section.work": "Arbeitsstand",
  "cockpit.section.feed": "Codex-Live-Feed",
  "cockpit.section.lastRun": "Letzter Lauf",
  "cockpit.section.upload": "Upload-Erfolg",
  "cockpit.section.newIn": "Was kam neu rein",
  "cockpit.section.scan": "Gefundene Dateien",
  "cockpit.section.scanByCategory": "Gefundene Dateien je Kategorie",
  "cockpit.section.history": "Verlauf (letzte Tage)",
  "cockpit.section.historyBars": "Verlauf — Uploads je Tag",

  "cockpit.empty.tasks": "Noch keine Aufgaben im Board.",
  "cockpit.empty.feedDone": "Letzter Codex-Lauf abgeschlossen. Beim nächsten Lauf erscheinen die Ereignisse hier live.",
  "cockpit.empty.feedIdle": "Kein aktiver Codex-Lauf. Übergib eine Aufgabe aus Action Queue oder Briefing.",
  "cockpit.empty.lastRun": "Noch kein Lauf — starte unten einen Sync.",
  "cockpit.empty.upload": "Noch keine Uploads erfasst.",
  "cockpit.empty.newIn": "Keine neuen Briefings im Rückkanal.",
  "cockpit.empty.scan": "Noch kein Scan ausgeführt.",
  "cockpit.empty.history": "Der Verlauf sammelt echte Daten ab dem ersten Lauf. Nach den nächsten Syncs erscheinen hier die Tage.",
  "cockpit.scan.other": "Sonstige",
  "cockpit.newIn.untitled": "Neues Briefing",

  // Aufgaben-Buckets (Donut/KPI)
  "tasks.open": "Offen",
  "tasks.executed": "Ausgeführt",
  "tasks.done": "Erledigt",
  "tasks.deferred": "Aufgeschoben",
  "tasks.problem": "Verworfen/Fehler",
  "tasks.todayDone": "Heute erledigt",

  // Letzter Lauf (KPI)
  "lastRun.duration": "Dauer",
  "lastRun.uploads": "Uploads",
  "lastRun.checked": "Geprüft",
  "lastRun.errors": "Fehler",
  "lastRun.warnings": "Warnungen",
  "upload.success": "Erfolgreich",
  "upload.failed": "Fehlgeschlagen",

  // Nächster Lauf (computeNextRun)
  "next.none": "Kein automatischer Lauf geplant",
  "next.noWeekdays": "Keine Wochentage gewählt",
  "next.today": "Heute",
  "next.tomorrow": "Morgen",
  "next.value": "{day}, {time} Uhr",
  "next.scheduledAt": "geplant um {time} Uhr",

  // Arbeits-/Busy-Status (getWorkState)
  "work.scan.title": "Scan läuft",
  "work.scan.text": "KatoSync durchsucht die ausgewählten Hauptordner inklusive Unterordner.",
  "work.dryRun.title": "Dry-Run läuft",
  "work.dryRun.text": "CURRENT-Dateien werden neu erzeugt. Es wird nichts hochgeladen.",
  "work.sync.title": "Upload läuft",
  "work.sync.text": "Freigegebene CURRENT-Dateien werden an Mistral gesendet.",
  "work.connection.title": "Verbindungstest läuft",
  "work.connection.text": "KatoSync prüft den Mistral API-Zugang.",
  "work.library.title": "Library-Test läuft",
  "work.library.text": "KatoSync prüft, ob die Mistral Library erreichbar ist.",
  "work.mcpToken.title": "MCP Token wird gespeichert",
  "work.mcpToken.text": "Der Connector Token wird im macOS-Schlüsselbund gesichert.",
  "work.save.title": "Speichern läuft",
  "work.save.text": "Die lokale Konfiguration wird gesichert.",
  "work.logs.title": "Logs werden geladen",
  "work.logs.text": "KatoSync liest die lokalen Protokolle.",
  "work.launch.title": "Uploadplan wird geändert",
  "work.launch.text": "Der lokale LaunchAgent wird aktualisiert.",
  "work.actionPlans.title": "Action Queue wird geladen",
  "work.actionPlans.text": "KatoSync prüft lokale und spätere MCP-Action-Pläne.",
  "work.briefings.title": "Briefings werden geladen",
  "work.briefings.text": "KatoSync prüft neue Mistral-Ergebnisse aus dem Rückkanal."
} as const;

export type TKey = keyof typeof de;
export default de;
