import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  FileCheck2,
  FolderOpen,
  HardDriveUpload,
  KeyRound,
  Library,
  ListChecks,
  Loader2,
  Moon,
  Power,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TerminalSquare,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  FindingsTable,
  Metric,
  NoticeBar,
  Panel,
  StatusLine,
  StepButton,
  Toggle
} from "./components/Primitives";
import { weekdayLabels } from "./lib/defaults";
import { useKatoSyncViewModel, type StepId } from "./viewmodels/useKatoSyncViewModel";
import type { FileFinding, Weekday } from "./types";

const steps: Array<{ id: StepId; label: string; icon: typeof Activity }> = [
  { id: "dashboard", label: "Dashboard", icon: Database },
  { id: "api", label: "API", icon: KeyRound },
  { id: "library", label: "Library", icon: Library },
  { id: "folders", label: "Ordner", icon: FolderOpen },
  { id: "rules", label: "Regeln", icon: SlidersHorizontal },
  { id: "schedule", label: "Uploadplan", icon: CalendarClock },
  { id: "logs", label: "Aktivitäten", icon: TerminalSquare }
];

const weekdays = Object.keys(weekdayLabels) as Weekday[];
type ThemeMode = "dark" | "light";
const onboardingDoneKey = "katosync.onboarding.done";
const splashSeenKey = "katosync.onboarding.splashSeen";

const sectionByStep: Record<StepId, string> = {
  welcome: "section-status",
  api: "section-api",
  library: "section-library",
  folders: "section-folders",
  rules: "section-rules",
  schedule: "section-schedule",
  dashboard: "section-status",
  logs: "section-activities"
};

const onboardingSteps: Array<{
  title: string;
  text: string;
  sectionId: string;
  step: StepId;
}> = [
  {
    title: "Mistral-Zugang speichern",
    text: "Füge zuerst deinen Mistral API-Key ein, speichere ihn im Schlüsselbund und trage die Library ID ein.",
    sectionId: "section-api",
    step: "api"
  },
  {
    title: "Verbindung prüfen",
    text: "Teste API und Library einmal. Wenn beide grün sind, kann KatoSync sicher mit deiner Mistral Library sprechen.",
    sectionId: "section-api",
    step: "api"
  },
  {
    title: "Projektordner auswählen",
    text: "Wähle einen oder mehrere Hauptordner. KatoSync scannt auch Unterordner, damit keine Projektstände fehlen.",
    sectionId: "section-folders",
    step: "folders"
  },
  {
    title: "Regeln und Schutz prüfen",
    text: "Der Secret-Scanner bleibt aktiv. Status-, Memory-, Roadmap- und Task-Dateien werden gebündelt, Secret-Dateien übersprungen.",
    sectionId: "section-rules",
    step: "rules"
  },
  {
    title: "Uploadplan aktivieren",
    text: "Lege Uhrzeit und Wochentage fest. Der Mac muss eingeschaltet und angemeldet sein; nach dem Aufwachen startet macOS geplante Jobs normalerweise zum nächstmöglichen Zeitpunkt.",
    sectionId: "section-schedule",
    step: "schedule"
  },
  {
    title: "Einmal synchronisieren",
    text: "Starte zum Abschluss einen Sofortlauf. Danach arbeitet KatoSync automatisch nach deinem Uploadplan; manuell klickst du nur noch für Extra-Läufe.",
    sectionId: "section-sync",
    step: "dashboard"
  }
];

export default function App() {
  const vm = useKatoSyncViewModel();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem("katosync.theme");
    return stored === "light" ? "light" : "dark";
  });
  const [hintsOpen, setHintsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [showSplash, setShowSplash] = useState(() => !localStorage.getItem(splashSeenKey));
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const { config } = vm;
  const workState = getWorkState(vm.busy);
  const WorkIcon = workState?.icon;
  const activities = buildActivities(vm);
  const issueCount = getIssueCount(vm);
  const hints = buildHints(vm);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("katosync.theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!config) return;
    if (localStorage.getItem(onboardingDoneKey)) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(splashSeenKey, "true");
      setShowSplash(false);
      setOnboardingOpen(true);
      focusOnboardingStep(0);
    }, showSplash ? 1150 : 250);
    return () => window.clearTimeout(timer);
  }, [config, showSplash]);

  const handleStepSelect = (step: StepId) => {
    vm.setActiveStep(step);
    document.getElementById(sectionByStep[step])?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const jumpToSection = (step: StepId, sectionId: string) => {
    setHintsOpen(false);
    setOnboardingOpen(false);
    vm.setActiveStep(step);
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    setSpotlightId(sectionId);
    window.setTimeout(() => setSpotlightId(null), 1800);
  };

  const focusOnboardingStep = (index: number) => {
    const step = onboardingSteps[index];
    if (!step) return;
    setOnboardingIndex(index);
    vm.setActiveStep(step.step);
    document.getElementById(step.sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    setSpotlightId(step.sectionId);
  };

  const closeOnboarding = (done = false) => {
    setOnboardingOpen(false);
    setSpotlightId(null);
    if (done) localStorage.setItem(onboardingDoneKey, "true");
  };

  if (!config) {
    return (
      <div className="boot-screen">
        <Loader2 className="spin" size={28} />
        <span>KatoSync wird vorbereitet</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {showSplash && !localStorage.getItem(onboardingDoneKey) ? (
        <div className="startup-splash" aria-label="KatoSync startet">
          <img alt="" src="/katoos_icon_logo_trans.png" />
          <strong>KatoSync</strong>
        </div>
      ) : null}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img alt="" src="/katoos_icon_logo_trans.png" />
          </div>
          <div className="brand-copy">
            <strong>KatoSync</strong>
            <span>Project Memory Uploader</span>
          </div>
        </div>

        <nav className="steps">
          {steps.map((step) => (
            <StepButton
              active={vm.activeStep === step.id}
              icon={step.icon}
              key={step.id}
              label={step.label}
              onClick={() => handleStepSelect(step.id)}
            />
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="ghost danger compact-danger" onClick={vm.handleQuitApp} title="Programm beenden" type="button">
            <Power size={16} />
            <span>Programm beenden</span>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>KatoSync</h1>
            <p>Ein Dashboard für Mistral-Zugang, Projektordner, automatische Synchronisierung und Aktivitäten.</p>
          </div>
          <div className="setup-strip" aria-label="Setup-Fortschritt">
            <div className="completion-head">
              <span>Setup</span>
              <strong>{vm.completion}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${vm.completion}%` }} />
            </div>
            <p>
              Key {vm.keyStatus.exists ? "gespeichert" : "fehlt"} ·{" "}
              {vm.launchStatus?.installed ? "Uploadplan aktiv" : "Uploadplan offen"}
            </p>
            {issueCount ? (
              <button className="issue-badge" onClick={() => setHintsOpen(true)} type="button">
                {issueCount} Sicherheitshinweise
              </button>
            ) : null}
          </div>
          <div className="top-actions">
            <button
              aria-label={theme === "dark" ? "Light-Mode aktivieren" : "Dark-Mode aktivieren"}
              aria-pressed={theme === "light"}
              className={`theme-switch ${theme}`}
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Light-Mode aktivieren" : "Dark-Mode aktivieren"}
              type="button"
            >
              <Sun size={15} />
              <Moon size={15} />
              <span className="theme-knob" />
            </button>
            <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.persist} type="button">
              {vm.busy === "save" ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
              Einstellungen speichern
            </button>
          </div>
        </header>

        {workState && WorkIcon ? (
          <div className="work-banner" role="status" aria-live="polite">
            <WorkIcon className="spin" size={18} />
            <div>
              <strong>{workState.title}</strong>
              <span>{workState.text}</span>
            </div>
          </div>
        ) : null}

        {vm.notice ? <NoticeBar notice={vm.notice} onClose={() => vm.setNotice(null)} /> : null}

        {hintsOpen ? (
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setHintsOpen(false);
            }}
            role="presentation"
          >
            <section aria-labelledby="hint-title" aria-modal="true" className="hint-dialog" role="dialog">
              <header>
                <div>
                  <span className="section-label">Diagnose</span>
                  <h2 id="hint-title">Sicherheitshinweise</h2>
                  <p>Diese Hinweise bedeuten nicht, dass das Setup offen ist. KatoSync zeigt hier übersprungene Secret-Dateien oder Upload-Fehler.</p>
                </div>
                <button aria-label="Hinweise schließen" className="icon-button" onClick={() => setHintsOpen(false)} type="button">
                  <X size={18} />
                </button>
              </header>
              <div className="hint-list">
                {hints.map((hint) => (
                  <article className={`hint-row ${hint.kind}`} key={`${hint.title}-${hint.text}`}>
                    <AlertTriangle size={16} />
                    <div>
                      <strong>{hint.title}</strong>
                      <span>{hint.text}</span>
                    </div>
                  </article>
                ))}
              </div>
              <footer>
                <button className="secondary" onClick={() => jumpToSection("folders", "section-findings")} type="button">
                  Gefundene Dateien anzeigen
                </button>
                <button className="secondary" onClick={() => jumpToSection("rules", "section-rules")} type="button">
                  Sync-Regeln prüfen
                </button>
                <button className="ghost" onClick={() => setHintsOpen(false)} type="button">
                  Schließen
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <section className="dashboard-grid overview-grid">
          <Panel className="hero-panel" id="section-status">
            <div>
              <span className="section-label">Status</span>
              <h2>{vm.report ? "Letzter Lauf ist bereit" : "Bereit für die Einrichtung"}</h2>
              <p>
                KatoSync sammelt relevante Projektstände, schützt Secret-Dateien und synchronisiert
                die CURRENT-Dateien mit deiner Mistral Library.
              </p>
            </div>
            <div className="hero-metrics">
              <Metric label="Relevant" value={vm.scan?.relevantFiles ?? vm.report?.scan.relevantFiles ?? 0} />
              <Metric label="Secrets" value={vm.scan?.secretWarnings ?? vm.report?.scan.secretWarnings ?? 0} tone="warn" />
              <Metric label="Uploads" value={vm.report?.uploaded.length ?? 0} tone="ok" />
            </div>
          </Panel>

          <Panel id="section-api" title="Mistral Zugang" icon={<KeyRound size={18} />}>
            <div className="form-grid">
              <label>
                API-Key
                <div className="inline-input">
                  <input
                    onChange={(event) => vm.setKeyInput(event.target.value)}
                    placeholder={vm.keyStatus.masked || "mistral_..."}
                    type="password"
                    value={vm.keyInput}
                  />
                  <button disabled={Boolean(vm.busy)} onClick={vm.handleSaveKey} type="button" title="API-Key speichern">
                    {vm.busy === "key" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                  </button>
                </div>
              </label>
              <label>
                Library ID
                <input
                  onChange={(event) => vm.updateConfig("libraryId", event.target.value)}
                  placeholder="mistral-library-id"
                  value={config.libraryId}
                />
              </label>
              <label>
                Gerätename
                <input
                  onChange={(event) =>
                    vm.updateConfig("device", {
                      ...config.device,
                      deviceName: event.target.value
                    })
                  }
                  placeholder="Arbeitslaptop"
                  value={config.device.deviceName}
                />
                <span className="field-hint">
                  Geräte-ID: {config.device.deviceId || "wird automatisch erstellt"}
                </span>
              </label>
            </div>
            <div className="button-row">
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleTestConnection} type="button">
                {vm.busy === "connection" ? <Loader2 className="spin" size={15} /> : null}
                {vm.busy === "connection" ? "Test läuft" : "Verbindung testen"}
              </button>
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleTestLibrary} type="button">
                {vm.busy === "library" ? <Loader2 className="spin" size={15} /> : null}
                {vm.busy === "library" ? "Test läuft" : "Library testen"}
              </button>
              <button className="ghost danger" disabled={Boolean(vm.busy)} onClick={vm.handleDeleteKey} type="button">
                <Trash2 size={15} />
                Key löschen
              </button>
            </div>
          </Panel>

          <Panel id="section-library" title="API-Kontingent" icon={<Activity size={18} />}>
            {vm.rateLimits.length ? (
              <div className="quota-list">
                {vm.rateLimits.map((metric) => (
                  <div className="quota-row" key={`${metric.label}-${metric.limit}-${metric.remaining}`}>
                    <div>
                      <strong>{metric.label}</strong>
                      <span>
                        {metric.remaining ?? "unbekannt"} von {metric.limit ?? "unbekannt"} übrig
                      </span>
                    </div>
                    <div className="quota-bar">
                      <span style={{ width: quotaWidth(metric.remaining, metric.limit) }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="quota-empty">
                <strong>Noch nicht gemessen</strong>
                <span>
                  Nach Verbindungstest, Library-Test oder Upload zeigt KatoSync die von Mistral
                  gelieferten Rate-Limit-Werte an.
                </span>
              </div>
            )}
            <p className="field-hint">
              Free- und Scale-Limits ändern sich je Plan, Modell und Organisation. Deshalb liest
              KatoSync Live-Header statt feste Zahlen zu raten.
            </p>
          </Panel>

          <Panel id="section-folders" title="Projektordner" icon={<FolderOpen size={18} />}>
            <div className="folder-list">
              {config.sourceRoots.length ? (
                config.sourceRoots.map((root) => (
                  <div className="folder-row" key={root}>
                    <HardDriveUpload size={16} />
                    <span>{root}</span>
                    <button
                      disabled={Boolean(vm.busy)}
                      onClick={() =>
                        vm.updateConfig(
                          "sourceRoots",
                          config.sourceRoots.filter((item) => item !== root)
                        )
                      }
                      title="Ordner entfernen"
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">Noch kein Projektordner ausgewählt.</div>
              )}
            </div>
            <p className="field-hint">
              Browser-Demo: Pfad manuell eintragen. Desktop-App: Finder-Auswahl.
            </p>
            <div className="button-row">
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleChooseFolders} type="button">
                <FolderOpen size={15} />
                Ordner auswählen
              </button>
              <button
                className={vm.busy === "scan" ? "secondary busy-action" : "secondary"}
                disabled={Boolean(vm.busy)}
                onClick={vm.handleScan}
                type="button"
              >
                <RefreshCcw className={vm.busy === "scan" ? "spin" : undefined} size={15} />
                {vm.busy === "scan" ? "Scan läuft" : "Scan testen"}
              </button>
            </div>
          </Panel>

          <Panel
            className={spotlightId === "section-rules" ? "spotlight-target" : ""}
            id="section-rules"
            title="Sync-Regeln"
            icon={<ListChecks size={18} />}
          >
            <div className="switch-grid">
              <Toggle
                checked={config.scanRules.includeMemory}
                label="Memory-Dateien"
                onChange={(checked) => vm.updateNested("scanRules", { includeMemory: checked })}
              />
              <Toggle
                checked={config.scanRules.includeRoadmaps}
                label="Roadmaps"
                onChange={(checked) => vm.updateNested("scanRules", { includeRoadmaps: checked })}
              />
              <Toggle
                checked={config.scanRules.includeTasks}
                label="Tasks/Todos"
                onChange={(checked) => vm.updateNested("scanRules", { includeTasks: checked })}
              />
              <Toggle
                checked={config.safety.secretScanEnabled}
                label="Secret-Scanner"
                onChange={(checked) => vm.updateNested("safety", { secretScanEnabled: checked })}
              />
              <Toggle
                checked={config.scanRules.uploadIndividualStatusFiles}
                label="Einzeldateien optional"
                onChange={(checked) => vm.updateNested("scanRules", { uploadIndividualStatusFiles: checked })}
              />
            </div>
            <div className="range-row">
              <label>
                Max. Dateigröße
                <input
                  max={50}
                  min={1}
                  onChange={(event) =>
                    vm.updateNested("scanRules", { maxFileSizeMb: Number(event.target.value) })
                  }
                  type="range"
                  value={config.scanRules.maxFileSizeMb}
                />
                <span>{config.scanRules.maxFileSizeMb} MB</span>
              </label>
              <label>
                Einzel-Uploads
                <input
                  max={20}
                  min={0}
                  onChange={(event) =>
                    vm.updateNested("scanRules", { maxIndividualUploads: Number(event.target.value) })
                  }
                  type="number"
                value={config.scanRules.maxIndividualUploads}
              />
            </label>
          </div>
        </Panel>

          <Panel id="section-schedule" title="Lokaler Uploadplan" icon={<Clock3 size={18} />}>
            <div className="schedule-row">
              <Toggle
                checked={config.schedule.enabled}
                label="Automatischer Upload"
                onChange={(checked) => vm.updateNested("schedule", { enabled: checked })}
              />
              <label>
                Uhrzeit
                <input
                  onChange={(event) => {
                    const [hour, minute] = event.target.value.split(":").map(Number);
                    vm.updateNested("schedule", { hour, minute });
                  }}
                  type="time"
                  value={`${String(config.schedule.hour).padStart(2, "0")}:${String(
                    config.schedule.minute
                  ).padStart(2, "0")}`}
                />
              </label>
            </div>
            <div className="weekday-row">
              {weekdays.map((day) => {
                const checked = config.schedule.weekdays.includes(day);
                return (
                  <button
                    className={checked ? "weekday active" : "weekday"}
                    key={day}
                    disabled={Boolean(vm.busy)}
                    onClick={() => {
                      const next = checked
                        ? config.schedule.weekdays.filter((item) => item !== day)
                        : [...config.schedule.weekdays, day];
                      vm.updateNested("schedule", { weekdays: next });
                    }}
                    type="button"
                  >
                    {weekdayLabels[day]}
                  </button>
                );
              })}
            </div>
            <div className="button-row">
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleLaunchInstall} type="button">
                {vm.busy === "launch" ? <Loader2 className="spin" size={15} /> : null}
                {vm.busy === "launch" ? "Wird installiert" : "LaunchAgent installieren"}
              </button>
              <button className="ghost" disabled={Boolean(vm.busy)} onClick={vm.handleLaunchRemove} type="button">
                LaunchAgent entfernen
              </button>
            </div>
            <StatusLine
              good={Boolean(vm.launchStatus?.installed && vm.launchStatus.loaded)}
              text={vm.launchStatus?.message || "Status unbekannt"}
            />
          </Panel>

          <Panel
            className={`table-panel ${spotlightId === "section-findings" ? "spotlight-target" : ""}`}
            id="section-findings"
            title="Gefundene Dateien"
            icon={<Database size={18} />}
          >
            <FindingsTable scan={vm.scan ?? vm.report?.scan ?? null} />
          </Panel>

          <Panel className="run-panel" id="section-sync" title="Sync ausführen" icon={<UploadCloud size={18} />}>
            <p className="field-hint">
              {config.schedule.enabled
                ? "Automatischer Upload ist aktiv. Dieser Button startet nur einen zusätzlichen Sofortlauf."
                : "Ohne Uploadplan startest du den Sync manuell. Mit aktivem Uploadplan läuft KatoSync zur gewählten Zeit automatisch."}
            </p>
            <div className="button-stack">
              <button
                className={vm.busy === "sync" ? "primary busy-action" : "primary"}
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleRun(false)}
                type="button"
              >
                {vm.busy === "sync" ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}
                {vm.busy === "sync"
                  ? "Sync läuft"
                  : config.schedule.enabled
                    ? "Jetzt zusätzlich synchronisieren"
                    : "Jetzt synchronisieren"}
              </button>
              <button
                className={vm.busy === "dry-run" ? "secondary busy-action" : "secondary"}
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleRun(true)}
                type="button"
              >
                {vm.busy === "dry-run" ? <Loader2 className="spin" size={16} /> : <FileCheck2 size={16} />}
                {vm.busy === "dry-run" ? "Testlauf läuft" : "Testlauf ohne Upload"}
              </button>
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={() => void vm.openOutputDir()} type="button">
                Output öffnen
              </button>
            </div>
            <StatusLine
              good={!vm.report?.errors.length}
              text={vm.report ? `${vm.report.currentFiles.length} CURRENT-Dateien erzeugt` : "Noch kein Lauf"}
            />
          </Panel>

          <Panel id="section-activities" className="logs-panel" title="Aktivitäten" icon={<TerminalSquare size={18} />}>
            <div className="activity-list">
              {activities.map((item) => (
                <div className={`activity-item ${item.kind}`} key={item.text}>
                  <span />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.text}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleLogs} type="button">
                {vm.busy === "logs" ? <Loader2 className="spin" size={15} /> : null}
                {vm.busy === "logs" ? "Logs werden geladen" : "Logs laden"}
              </button>
            </div>
            <pre>{vm.logs || "Noch keine Logs geladen."}</pre>
          </Panel>
        </section>
      </main>

      {onboardingOpen ? (
        <OnboardingDialog
          currentIndex={onboardingIndex}
          onBack={() => focusOnboardingStep(Math.max(0, onboardingIndex - 1))}
          onClose={() => closeOnboarding(false)}
          onDone={() => closeOnboarding(true)}
          onNext={() => {
            const next = onboardingIndex + 1;
            if (next >= onboardingSteps.length) {
              closeOnboarding(true);
              return;
            }
            focusOnboardingStep(next);
          }}
        />
      ) : null}
    </div>
  );
}

function OnboardingDialog({
  currentIndex,
  onBack,
  onClose,
  onDone,
  onNext
}: {
  currentIndex: number;
  onBack: () => void;
  onClose: () => void;
  onDone: () => void;
  onNext: () => void;
}) {
  const step = onboardingSteps[currentIndex];
  const isLast = currentIndex === onboardingSteps.length - 1;

  return (
    <div className="onboarding-layer" role="presentation">
      <section aria-labelledby="onboarding-title" aria-modal="true" className="onboarding-card" role="dialog">
        <button aria-label="Onboarding schließen" className="icon-button onboarding-close" onClick={onClose} type="button">
          <X size={17} />
        </button>
        <div className="onboarding-brand">
          <img alt="" src="/katoos_icon_logo_trans.png" />
          <span>Erster Start</span>
        </div>
        <div className="onboarding-progress" aria-label={`Schritt ${currentIndex + 1} von ${onboardingSteps.length}`}>
          {onboardingSteps.map((item, index) => (
            <span className={index <= currentIndex ? "active" : ""} key={item.title} />
          ))}
        </div>
        <h2 id="onboarding-title">{step.title}</h2>
        <p>{step.text}</p>
        <footer>
          <button className="ghost" onClick={onDone} type="button">
            Später
          </button>
          <div>
            <button className="secondary" disabled={currentIndex === 0} onClick={onBack} type="button">
              Zurück
            </button>
            <button className="primary" onClick={onNext} type="button">
              {isLast ? "Fertig" : "Weiter"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function quotaWidth(remaining?: string | null, limit?: string | null) {
  const remainingNumber = Number(remaining);
  const limitNumber = Number(limit);
  if (!Number.isFinite(remainingNumber) || !Number.isFinite(limitNumber) || limitNumber <= 0) {
    return "0%";
  }
  return `${Math.max(0, Math.min(100, Math.round((remainingNumber / limitNumber) * 100)))}%`;
}

function getWorkState(busy: string | null) {
  switch (busy) {
    case "scan":
      return {
        icon: RefreshCcw,
        title: "Scan läuft",
        text: "KatoSync durchsucht die ausgewählten Hauptordner inklusive Unterordner."
      };
    case "dry-run":
      return {
        icon: FileCheck2,
        title: "Dry-Run läuft",
        text: "CURRENT-Dateien werden neu erzeugt. Es wird nichts hochgeladen."
      };
    case "sync":
      return {
        icon: UploadCloud,
        title: "Upload läuft",
        text: "Freigegebene CURRENT-Dateien werden an Mistral gesendet."
      };
    case "connection":
      return {
        icon: KeyRound,
        title: "Verbindungstest läuft",
        text: "KatoSync prüft den Mistral API-Zugang."
      };
    case "library":
      return {
        icon: Library,
        title: "Library-Test läuft",
        text: "KatoSync prüft, ob die Mistral Library erreichbar ist."
      };
    case "save":
      return {
        icon: CheckCircle2,
        title: "Speichern läuft",
        text: "Die lokale Konfiguration wird gesichert."
      };
    case "logs":
      return {
        icon: TerminalSquare,
        title: "Logs werden geladen",
        text: "KatoSync liest die lokalen Protokolle."
      };
    case "launch":
      return {
        icon: CalendarClock,
        title: "Uploadplan wird geändert",
        text: "Der lokale LaunchAgent wird aktualisiert."
      };
    default:
      return null;
  }
}

function buildActivities(vm: ReturnType<typeof useKatoSyncViewModel>) {
  const items: Array<{ kind: "ok" | "warn" | "error" | "info"; title: string; text: string }> = [];
  if (vm.report) {
    items.push({
      kind: vm.report.errors.length ? "error" : "ok",
      title: vm.report.dryRun ? "Testlauf abgeschlossen" : "Synchronisierung abgeschlossen",
      text: `${vm.report.currentFiles.length} CURRENT-Dateien erzeugt, ${vm.report.uploaded.length} Uploads.`
    });
    if (vm.report.errors.length) {
      items.push({ kind: "error", title: "Fehler erkannt", text: vm.report.errors[0] });
    }
    if (vm.report.warnings.length) {
      items.push({ kind: "warn", title: "Warnung", text: vm.report.warnings[0] });
    }
  }
  if (vm.scan) {
    items.push({
      kind: vm.scan.secretWarnings ? "warn" : "ok",
      title: "Letzter Scan",
      text: `${vm.scan.relevantFiles} relevante Dateien, ${vm.scan.secretWarnings} Secret-Warnungen.`
    });
  }
  if (vm.launchStatus) {
    items.push({
      kind: vm.launchStatus.installed ? "ok" : "info",
      title: "Uploadplan",
      text: vm.launchStatus.message
    });
  }
  if (!items.length) {
    items.push({
      kind: "info",
      title: "Noch keine Aktivität",
      text: "Starte einen Scan oder eine Synchronisierung, um Ereignisse zu sehen."
    });
  }
  return items.slice(0, 5);
}

function getIssueCount(vm: ReturnType<typeof useKatoSyncViewModel>) {
  return (vm.scan?.secretWarnings ?? vm.report?.scan.secretWarnings ?? 0) + (vm.report?.errors.length ?? 0);
}

function buildHints(vm: ReturnType<typeof useKatoSyncViewModel>) {
  const scan = vm.scan ?? vm.report?.scan ?? null;
  const hints: Array<{ kind: "warn" | "error" | "info"; title: string; text: string }> = [];
  const secretFiles = scan?.findings.filter(isSecretHint) ?? [];

  secretFiles.slice(0, 8).forEach((finding) => {
    hints.push({
      kind: "warn",
      title: "Secret-Datei übersprungen",
      text: `${finding.relativePath}: ${finding.reason || "vom Secret-Scanner geschützt"}`
    });
  });

  if (scan && scan.secretWarnings > secretFiles.length) {
    hints.push({
      kind: "warn",
      title: "Weitere Secret-Hinweise",
      text: `${scan.secretWarnings - secretFiles.length} weitere Datei(en) wurden geschützt übersprungen.`
    });
  }

  vm.report?.errors.forEach((error) => {
    hints.push({
      kind: "error",
      title: "Upload-Fehler",
      text: error
    });
  });

  if (!hints.length) {
    hints.push({
      kind: "info",
      title: "Alles sauber",
      text: "Es gibt aktuell keine offenen Sicherheits- oder Upload-Hinweise."
    });
  }

  return hints;
}

function isSecretHint(finding: FileFinding) {
  const reason = finding.reason?.toLowerCase() ?? "";
  return finding.skipped && (finding.category === "secret" || reason.includes("secret"));
}
