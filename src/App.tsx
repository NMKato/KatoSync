import {
  Activity,
  AlertTriangle,
  BookOpenText,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Database,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  HardDriveUpload,
  KeyRound,
  LayoutGrid,
  Library,
  ListChecks,
  Loader2,
  Moon,
  Power,
  PlayCircle,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Settings,
  SlidersHorizontal,
  Square,
  StopCircle,
  Sun,
  TerminalSquare,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FindingsTable,
  Metric,
  NoticeBar,
  Panel,
  StatusLine,
  StepButton,
  Toggle
} from "./components/Primitives";
import { licenseAgreement } from "./lib/license";
import { weekdayLabels } from "./lib/defaults";
import {
  useKatoSyncViewModel,
  type BoardTask,
  type StepId
} from "./viewmodels/useKatoSyncViewModel";
import { NO_PROJECT_ID } from "./repositories/katoSyncRepository";
import type { ActionPlan, ActionTaskStatus, Briefing, FileFinding, Weekday } from "./types";

const steps: Array<{ id: StepId; label: string; icon: typeof Activity }> = [
  { id: "dashboard", label: "Dashboard", icon: Database },
  { id: "actionQueue", label: "Action Queue", icon: ClipboardList },
  { id: "projectBoard", label: "Projekt-Board", icon: LayoutGrid },
  { id: "briefings", label: "Briefings", icon: BookOpenText },
  { id: "settings", label: "Einstellungen", icon: Settings },
  { id: "logs", label: "Aktivitäten", icon: TerminalSquare }
];

const weekdays = Object.keys(weekdayLabels) as Weekday[];
type ThemeMode = "dark" | "light";
const onboardingDoneKey = "katosync.onboarding.done";
const splashSeenKey = "katosync.onboarding.splashSeen";
const acknowledgedHintsKey = "katosync.acknowledgedHints";
const acceptedLicenseKey = "katosync.license.acceptedVersion";

const sectionByStep: Record<StepId, string> = {
  welcome: "section-status",
  api: "section-api",
  library: "section-library",
  folders: "section-folders",
  rules: "section-rules",
  schedule: "section-schedule",
  dashboard: "section-status",
  actionQueue: "section-action-queue",
  projectBoard: "section-project-board",
  briefings: "section-briefings",
  settings: "section-api",
  logs: "section-activities"
};

const onboardingSteps: Array<{
  title: string;
  text: string;
  sectionId: string;
  step: StepId;
}> = [
  {
    title: "Schritt 1 — Mistral API-Key",
    text: "Füge deinen Mistral API-Key ein, speichere ihn im Schlüsselbund und teste die Verbindung. Den Key findest du unter console.mistral.ai → API Keys.",
    sectionId: "section-api-key",
    step: "api"
  },
  {
    title: "Schritt 2 — Library-ID",
    text: "Trage deine Mistral Library-ID ein und teste die Library. Die ID findest du in Mistral bei deiner Library (URL/Einstellungen).",
    sectionId: "section-api-library",
    step: "api"
  },
  {
    title: "Schritt 3 — MCP-Connector-Token",
    text: "Generiere deinen Connector-Token, kopiere ihn und trage DENSELBEN Token im Mistral-Connector ein (gleicher Token = gleicher Tenant). Achtung: Er wird nur EINMAL angezeigt — bei Verlust neu generieren und an beiden Stellen neu eintragen.",
    sectionId: "section-mcp-token",
    step: "api"
  },
  {
    title: "Schritt 4 — Projektordner",
    text: "Wähle einen oder mehrere Hauptordner deiner Projekte. KatoSync scannt auch Unterordner, damit keine Projektstände fehlen.",
    sectionId: "section-folders",
    step: "folders"
  },
  {
    title: "Schritt 5 — Uploadplan aktivieren",
    text: "Lege Uhrzeit und Wochentage fest und installiere den LaunchAgent, damit KatoSync automatisch nach Plan synchronisiert. Danach ist die Einrichtung abgeschlossen.",
    sectionId: "section-schedule",
    step: "schedule"
  }
];

function toVisibleStep(step: StepId): StepId {
  // Alles Setup lebt in den Einstellungen (auch Quellordner + Uploadplan).
  if (
    step === "api" ||
    step === "library" ||
    step === "rules" ||
    step === "folders" ||
    step === "schedule"
  ) {
    return "settings";
  }
  return step;
}

function pageCopy(step: StepId) {
  switch (toVisibleStep(step)) {
    case "actionQueue":
      return {
        title: "Action Queue",
        text: "Agent-Pläne lokal prüfen, freigeben oder ablehnen. Es wird nichts automatisch ausgeführt."
      };
    case "projectBoard":
      return {
        title: "Projekt-Board",
        text: "Freigegebene Aufgaben pro Projekt einplanen, sortieren und sequenziell an Codex übergeben."
      };
    case "briefings":
      return {
        title: "Briefings",
        text: "Mistral-Ergebnisse lesen, priorisieren und für die lokale Umsetzung vorbereiten."
      };
    case "settings":
      return {
        title: "Einstellungen",
        text: "Mistral, MCP, Gerätekennung, Sync-Regeln und lokale Runner-Verbindungen gebündelt."
      };
    case "logs":
      return {
        title: "Aktivitäten",
        text: "Protokolle, Hinweise und letzte Entscheidungen an einem Ort."
      };
    default:
      return {
        title: "KatoSync",
        text: "Dashboard für Sync, Uploadplan, Action Queue und aktuellen Status."
      };
  }
}

type OnboardingPlacement = "left" | "right" | "top" | "bottom";

interface OnboardingPosition {
  left: number;
  top: number;
  placement: OnboardingPlacement;
}

export default function App() {
  const vm = useKatoSyncViewModel();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem("katosync.theme");
    return stored === "light" ? "light" : "dark";
  });
  const [hintsOpen, setHintsOpen] = useState(false);
  const [acknowledgedHintSignature, setAcknowledgedHintSignature] = useState(
    () => localStorage.getItem(acknowledgedHintsKey) ?? ""
  );
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingSnoozed, setOnboardingSnoozed] = useState(false);
  // Praesentationsmodus: maskiert sensible Werte (Token/Library-ID/Geraete-ID/E-Mail) fuer Screenshots/Streams.
  const [presentation, setPresentation] = useState(() => localStorage.getItem("katosync.presentation") === "1");
  const togglePresentation = () =>
    setPresentation((on) => {
      const next = !on;
      localStorage.setItem("katosync.presentation", next ? "1" : "0");
      return next;
    });
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [onboardingPosition, setOnboardingPosition] = useState<OnboardingPosition | null>(null);
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(
    () => localStorage.getItem(acceptedLicenseKey) !== licenseAgreement.version
  );
  const [licenseChecked, setLicenseChecked] = useState(false);
  const { config } = vm;
  const workState = getWorkState(vm.busy);
  const WorkIcon = workState?.icon;
  const activities = buildActivities(vm);
  const visibleStep = toVisibleStep(vm.activeStep);
  const page = pageCopy(visibleStep);
  const issueCount = getIssueCount(vm);
  const hints = buildHints(vm);
  const hintSignature = useMemo(() => buildHintSignature(hints), [hints]);
  const hasNewHints = issueCount > 0 && hintSignature !== acknowledgedHintSignature;
  // Eine Quelle der Wahrheit: identisch zur Setup-%-Berechnung im ViewModel (vm.setupGates).
  const onboardingCompletion = vm.setupGates;
  const getNextOnboardingIndex = useCallback(
    (startIndex: number) => {
      const next = onboardingCompletion.findIndex((complete, index) => index >= startIndex && !complete);
      return next === -1 ? -1 : next;
    },
    [onboardingCompletion]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("katosync.theme", theme);
  }, [theme]);

  // Splash: animiertes Logo bei JEDEM Start, dann ausblenden.
  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  // Onboarding-Pflicht: nach Splash + Login + Nutzungsbedingungen, solange Setup < 100 %.
  useEffect(() => {
    if (!config || showSplash) return;
    if (!vm.sessionStatus.loggedIn) return;
    if (licenseOpen) return;
    const firstOpenStep = getNextOnboardingIndex(0);
    if (firstOpenStep === -1) {
      localStorage.setItem(onboardingDoneKey, "true");
      if (onboardingOpen) setOnboardingOpen(false);
      return;
    }
    if (!onboardingOpen && !onboardingSnoozed) {
      setOnboardingOpen(true);
      focusOnboardingStep(firstOpenStep);
    }
  }, [
    config,
    getNextOnboardingIndex,
    licenseOpen,
    onboardingOpen,
    onboardingSnoozed,
    showSplash,
    vm.sessionStatus.loggedIn
  ]);

  const acceptLicense = () => {
    localStorage.setItem(acceptedLicenseKey, licenseAgreement.version);
    setLicenseChecked(false);
    setLicenseOpen(false);
  };

  const handleStepSelect = (step: StepId) => {
    vm.setActiveStep(step);
    document.getElementById(sectionByStep[step])?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const acknowledgeHints = useCallback(() => {
    if (!hintSignature) return;
    localStorage.setItem(acknowledgedHintsKey, hintSignature);
    setAcknowledgedHintSignature(hintSignature);
    setHintsOpen(false);
  }, [hintSignature]);

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

  const updateOnboardingPosition = useCallback(() => {
    if (!onboardingOpen) return;
    const step = onboardingSteps[onboardingIndex];
    if (!step) return;
    const target = document.getElementById(spotlightId ?? step.sectionId);
    const card = document.querySelector<HTMLElement>(".onboarding-card");
    if (!target || !card) return;

    const rect = target.getBoundingClientRect();
    const cardWidth = card.offsetWidth || Math.min(360, window.innerWidth - 48);
    const cardHeight = card.offsetHeight || 300;
    const margin = 16;
    const gap = 16;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const clampLeft = (value: number) =>
      Math.min(Math.max(value, margin), Math.max(margin, viewportWidth - cardWidth - margin));

    // Karte IMMER auf die gegenueberliegende Haelfte des Ziels legen -> verdeckt das Feld nie,
    // auch bei kleinem Fenster. Horizontal unter/ueber dem Feld zentriert, in den Viewport geklemmt.
    const left = clampLeft(rect.left + rect.width / 2 - cardWidth / 2);
    const targetCenterY = rect.top + rect.height / 2;
    const placeBelow = targetCenterY < viewportHeight * 0.5;
    const top = placeBelow
      ? Math.min(rect.bottom + gap, viewportHeight - cardHeight - margin)
      : Math.max(rect.top - cardHeight - gap, margin);

    setOnboardingPosition({ left, top, placement: placeBelow ? "bottom" : "top" });
  }, [onboardingIndex, onboardingOpen, spotlightId]);

  const focusOnboardingStep = (index: number) => {
    const step = onboardingSteps[index];
    if (!step) return;
    setOnboardingIndex(index);
    vm.setActiveStep(step.step);
    setSpotlightId(step.sectionId);
    // Smooth zum Feld scrollen. Die Karten-Positionierung uebernimmt der Effekt unten
    // (mit frischer Closure: sofort + nach dem Scroll), damit die Karte zuverlaessig erscheint.
    window.requestAnimationFrame(() => {
      document.getElementById(step.sectionId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const closeOnboarding = (done = false) => {
    setOnboardingOpen(false);
    setSpotlightId(null);
    setOnboardingPosition(null);
    if (done) localStorage.setItem(onboardingDoneKey, "true");
  };

  useEffect(() => {
    if (!onboardingOpen) return undefined;
    // Position mit FRISCHER Closure berechnen: sofort (Karte erscheint schnell) + nach dem Smooth-Scroll
    // (stabile Endposition). Re-runs bei jedem Schrittwechsel, da updateOnboardingPosition von
    // onboardingIndex/spotlightId abhaengt. KEIN Scroll-Listener -> kein Hinterherwackeln.
    const update = () => updateOnboardingPosition();
    const raf = window.requestAnimationFrame(update);
    const t1 = window.setTimeout(update, 480);
    const t2 = window.setTimeout(update, 780);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", update);
    };
  }, [onboardingOpen, updateOnboardingPosition]);

  // Auto-Advance: ist der aktuelle Schritt erfuellt, gehe strikt EINEN Schritt weiter (1->5).
  useEffect(() => {
    if (!onboardingOpen || vm.busy || !onboardingCompletion[onboardingIndex]) return undefined;
    const timer = window.setTimeout(() => {
      if (onboardingIndex >= onboardingSteps.length - 1) {
        setOnboardingSnoozed(true);
        closeOnboarding(true);
        return;
      }
      focusOnboardingStep(onboardingIndex + 1);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [onboardingCompletion, onboardingIndex, onboardingOpen, vm.busy]);

  if (showSplash) {
    return (
      <div className="startup-splash" aria-label="KatoSync startet">
        <img alt="" src="/katoos_icon_logo_trans.png" />
        <strong>KatoSync</strong>
        <span className="startup-tagline">Project Memory Uploader</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="boot-screen">
        <Loader2 className="spin" size={28} />
        <span>KatoSync wird vorbereitet</span>
      </div>
    );
  }

  if (!vm.sessionStatus.loggedIn) {
    return <LoginGate vm={vm} />;
  }

  return (
    <div className="app-shell">
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
              active={visibleStep === step.id}
              icon={step.icon}
              key={step.id}
              label={step.label}
              onClick={() => handleStepSelect(step.id)}
            />
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className={`ghost license-link${presentation ? " is-active" : ""}`}
            onClick={togglePresentation}
            title={presentation ? "Präsentationsmodus aus (Daten wieder sichtbar)" : "Präsentationsmodus an (sensible Daten maskieren)"}
            type="button"
          >
            {presentation ? <EyeOff size={16} /> : <Eye size={16} />}
            <span>{presentation ? "Präsentationsmodus an" : "Präsentationsmodus"}</span>
          </button>
          <button className="ghost license-link" onClick={() => setLicenseOpen(true)} title="Nutzungsvereinbarung anzeigen" type="button">
            <FileText size={16} />
            <span>Nutzungsvereinbarung</span>
          </button>
          <button className="ghost danger compact-danger" onClick={() => setQuitConfirmOpen(true)} title="Programm beenden" type="button">
            <Power size={16} />
            <span>Programm beenden</span>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{page.title}</h1>
            <p>{page.text}</p>
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
            {hasNewHints ? (
              <button className="issue-badge" onClick={() => setHintsOpen(true)} type="button">
                <span className="issue-count">{issueCount}</span>
                <span className="issue-label">Sicherheitshinweise</span>
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
              if (event.target === event.currentTarget) acknowledgeHints();
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
                <button aria-label="Hinweise schließen" className="icon-button" onClick={acknowledgeHints} type="button">
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
                <button
                  className="secondary"
                  onClick={() => {
                    acknowledgeHints();
                    jumpToSection("folders", "section-findings");
                  }}
                  type="button"
                >
                  Gefundene Dateien anzeigen
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    acknowledgeHints();
                    jumpToSection("rules", "section-rules");
                  }}
                  type="button"
                >
                  Sync-Regeln prüfen
                </button>
                <button className="ghost" onClick={acknowledgeHints} type="button">
                  Schließen
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <section className={`dashboard-grid overview-grid page-${visibleStep}`}>
          {visibleStep === "dashboard" ? (
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
          ) : null}

          {visibleStep === "settings" ? (
          <Panel className="settings-main-panel" id="section-api" title="Mistral Zugang" icon={<KeyRound size={18} />}>
            <div
              className={`form-grid ${spotlightId === "section-api-fields" ? "spotlight-target spotlight-pad" : ""}`}
              id="section-api-fields"
            >
              <label
                id="section-api-key"
                className={spotlightId === "section-api-key" ? "spotlight-target spotlight-pad" : ""}
              >
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
              <label
                id="section-api-library"
                className={spotlightId === "section-api-library" ? "spotlight-target spotlight-pad" : ""}
              >
                Library ID
                <input
                  onChange={(event) => vm.updateConfig("libraryId", event.target.value)}
                  placeholder="mistral-library-id"
                  type={presentation ? "password" : "text"}
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
                  Geräte-ID:{" "}
                  {config.device.deviceId
                    ? presentation
                      ? maskId(config.device.deviceId)
                      : config.device.deviceId
                    : "wird automatisch erstellt"}
                </span>
              </label>
              <label>
                MCP Server
                <input
                  onChange={(event) =>
                    vm.updateConfig("mcp", {
                      ...config.mcp,
                      baseUrl: event.target.value
                    })
                  }
                  placeholder="https://mcp.katoos.de"
                  value={config.mcp.baseUrl}
                />
                <span className="field-hint">
                  Basis-URL des Rückkanals — die App nutzt <code>/api</code>, deshalb hier OHNE <code>/mcp</code>.
                  In Mistral denselben Server MIT <code>/mcp</code> eintragen: {config.mcp.baseUrl.replace(/\/+$/, "")}/mcp
                </span>
              </label>
              <label>
                MCP Connector Token (manuell)
                <div className="inline-input">
                  <input
                    onChange={(event) => vm.setMcpTokenInput(event.target.value)}
                    placeholder={vm.mcpTokenStatus.masked || "Connector Token"}
                    type="password"
                    value={vm.mcpTokenInput}
                  />
                  <button
                    disabled={Boolean(vm.busy)}
                    onClick={vm.handleSaveMcpConnectorToken}
                    title="MCP Token speichern"
                    type="button"
                  >
                    {vm.busy === "mcp-token" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                  </button>
                </div>
              </label>
              <label
                id="section-mcp-token"
                className={spotlightId === "section-mcp-token" ? "spotlight-target spotlight-pad" : ""}
              >
                KatoSync Login (Token automatisch erzeugen)
                {vm.sessionStatus.loggedIn ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <span className="field-hint">
                      Angemeldet als{" "}
                      {presentation
                        ? maskEmail(vm.sessionStatus.email)
                        : vm.sessionStatus.email || "KatoOS-Konto"}
                      .
                    </span>
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={Boolean(vm.busy)}
                        onClick={vm.handleGenerateConnectorToken}
                        type="button"
                      >
                        {vm.busy === "mint-token" ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                        {vm.busy === "mint-token" ? "Generiere…" : "Connector-Token generieren"}
                      </button>
                      <button className="ghost" disabled={Boolean(vm.busy)} onClick={vm.handleLogout} type="button">
                        Abmelden
                      </button>
                    </div>
                    {vm.generatedToken ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <span className="field-hint" style={{ color: "#f59e0b" }}>
                          Dein neuer Connector-Token — nur JETZT sichtbar. Kopieren und in Mistral eintragen
                          (wird beim Minimieren/Tab-Wechsel ausgeblendet):
                        </span>
                        <TokenReveal
                          token={vm.generatedToken}
                          presentation={presentation}
                          onCopy={vm.handleCopyToken}
                        />
                        <span className="field-hint">
                          In Mistral Studio: MCP-Server {config.mcp.baseUrl.replace(/\/+$/, "")}/mcp manuell hinzufügen und diesen Token als Bearer hinterlegen.
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      autoComplete="username"
                      onChange={(event) => vm.setLoginEmail(event.target.value)}
                      placeholder="E-Mail"
                      type="email"
                      value={vm.loginEmail}
                    />
                    <input
                      autoComplete="current-password"
                      onChange={(event) => vm.setLoginPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") vm.handleLogin();
                      }}
                      placeholder="Passwort"
                      type="password"
                      value={vm.loginPassword}
                    />
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={Boolean(vm.busy)}
                        onClick={vm.handleLogin}
                        type="button"
                      >
                        {vm.busy === "login" ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                        Anmelden
                      </button>
                      <button
                        className="ghost"
                        disabled={Boolean(vm.busy)}
                        onClick={vm.handleRegister}
                        type="button"
                      >
                        {vm.busy === "register" ? <Loader2 className="spin" size={15} /> : null}
                        Registrieren
                      </button>
                    </div>
                  </div>
                )}
                <span className="field-hint">
                  Mit E-Mail registrieren oder anmelden, dann Connector-Token automatisch erzeugen. Google folgt. Das Feld oben bleibt als manueller Fallback.
                </span>
              </label>
            </div>
            <div
              className={`button-row ${spotlightId === "section-api-tests" ? "spotlight-target spotlight-pad" : ""}`}
              id="section-api-tests"
            >
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
              <button
                className="ghost danger"
                disabled={Boolean(vm.busy)}
                onClick={vm.handleDeleteMcpConnectorToken}
                type="button"
              >
                <Trash2 size={15} />
                MCP Token löschen
              </button>
            </div>
          </Panel>
          ) : null}

          {visibleStep === "dashboard" || visibleStep === "actionQueue" ? (
            <ActionQueuePanel vm={vm} expanded={visibleStep === "actionQueue"} />
          ) : null}

          {visibleStep === "settings" ? (
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
          ) : null}

          {visibleStep === "settings" ? (
          <Panel
            className={spotlightId === "section-folders" ? "spotlight-target" : ""}
            id="section-folders"
            title="Projektordner"
            icon={<FolderOpen size={18} />}
          >
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
          ) : null}

          {visibleStep === "settings" ? (
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
          ) : null}

          {visibleStep === "settings" ? (
          <Panel
            className={spotlightId === "section-schedule" ? "spotlight-target" : ""}
            id="section-schedule"
            title="Lokaler Uploadplan"
            icon={<Clock3 size={18} />}
          >
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
          ) : null}

          {visibleStep === "dashboard" ? (
          <Panel
            className={`table-panel ${spotlightId === "section-findings" ? "spotlight-target" : ""}`}
            id="section-findings"
            title="Gefundene Dateien"
            icon={<Database size={18} />}
          >
            <FindingsTable scan={vm.scan ?? vm.report?.scan ?? null} />
          </Panel>
          ) : null}

          {visibleStep === "dashboard" ? (
          <Panel className="run-panel" id="section-sync" title="Sync ausführen" icon={<UploadCloud size={18} />}>
            <p className="field-hint">
              {config.schedule.enabled
                ? "Automatischer Upload ist aktiv. Dieser Button startet nur einen zusätzlichen Sofortlauf."
                : "Ohne Uploadplan startest du den Sync manuell. Mit aktivem Uploadplan läuft KatoSync zur gewählten Zeit automatisch."}
            </p>
            <div
              className={`button-stack ${spotlightId === "section-sync-actions" ? "spotlight-target spotlight-pad" : ""}`}
              id="section-sync-actions"
            >
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
          ) : null}

          {visibleStep === "logs" ? (
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
          ) : null}

          {visibleStep === "projectBoard" ? <ProjectBoardPanel vm={vm} /> : null}
          {visibleStep === "briefings" ? <BriefingsPanel vm={vm} /> : null}
          {visibleStep === "settings" ? <CodexBridgePanel vm={vm} /> : null}
        </section>
      </main>

      {onboardingOpen ? (
        <OnboardingDialog
          currentIndex={onboardingIndex}
          done={Boolean(onboardingCompletion[onboardingIndex])}
          onBack={() => focusOnboardingStep(Math.max(0, onboardingIndex - 1))}
          onClose={() => {
            setOnboardingSnoozed(true);
            closeOnboarding(false);
          }}
          onDone={() => {
            setOnboardingSnoozed(true);
            closeOnboarding(false);
          }}
          onNext={() => {
            if (onboardingIndex >= onboardingSteps.length - 1) {
              setOnboardingSnoozed(true);
              closeOnboarding(true);
              return;
            }
            focusOnboardingStep(onboardingIndex + 1);
          }}
          position={onboardingPosition}
        />
      ) : null}

      {licenseOpen ? (
        <LicenseDialog
          accepted={localStorage.getItem(acceptedLicenseKey) === licenseAgreement.version}
          checked={licenseChecked}
          onAccept={acceptLicense}
          onCheckedChange={setLicenseChecked}
          onClose={() => {
            if (localStorage.getItem(acceptedLicenseKey) === licenseAgreement.version) {
              setLicenseChecked(false);
              setLicenseOpen(false);
            }
          }}
          onQuit={vm.handleQuitApp}
        />
      ) : null}

      {quitConfirmOpen ? (
        <div
          className="modal-backdrop quit-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQuitConfirmOpen(false);
          }}
          role="presentation"
        >
          <section aria-labelledby="quit-title" aria-modal="true" className="quit-dialog" role="dialog">
            <button
              aria-label="Dialog schließen"
              className="icon-button quit-close"
              onClick={() => setQuitConfirmOpen(false)}
              type="button"
            >
              <X size={18} />
            </button>
            <div className="quit-icon">
              <Power size={22} />
            </div>
            <span className="section-label">Programm beenden</span>
            <h2 id="quit-title">KatoSync wirklich komplett beenden?</h2>
            <p>
              Wenn du hier beendest, läuft KatoSync nicht mehr im Hintergrund und es werden keine
              automatischen Uploads aus dieser App gestartet.
            </p>
            <p>
              Wenn KatoSync weiter automatisch synchronisieren soll, schließe lieber das Fenster mit
              dem X oben. Dann wird die App nur ausgeblendet und bleibt im Hintergrund aktiv.
            </p>
            <footer>
              <button className="secondary" onClick={() => setQuitConfirmOpen(false)} type="button">
                Abbrechen
              </button>
              <button className="ghost danger quit-confirm" onClick={vm.handleQuitApp} type="button">
                <Power size={16} />
                Trotzdem beenden
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ActionQueuePanel({
  vm,
  expanded = false
}: {
  vm: ReturnType<typeof useKatoSyncViewModel>;
  expanded?: boolean;
}) {
  const visiblePlans = vm.actionPlans.filter(isOpenActionPlan);
  const pendingCount = visiblePlans.length;

  return (
    <Panel
      className={expanded ? "queue-panel action-queue-full" : "queue-panel"}
      id="section-action-queue"
      title="Action Queue"
      icon={<ClipboardList size={18} />}
    >
      <div className="queue-summary">
        <div>
          <strong>{pendingCount}</strong>
          <span>Pläne warten auf lokale Prüfung</span>
        </div>
        <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleRefreshActionPlans} type="button">
          {vm.busy === "action-plans" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
          Aktualisieren
        </button>
      </div>

      {visiblePlans.length ? (
        <div className="action-plan-list">
          {visiblePlans.slice(0, 3).map((plan) => (
            <article className="action-plan-card" key={plan.planId}>
              <header>
                <div>
                  <span className="agent-name">{plan.agentName}</span>
                  <strong>{formatPlanTitle(plan)}</strong>
                  <small>
                    {plan.createdAt} · {plan.executionMode === "sequential" ? "sequenziell" : "manuell"}
                  </small>
                </div>
                <span className={`risk-pill ${plan.riskLevel}`}>{riskLabel(plan.riskLevel)}</span>
              </header>
              <ol>
                {plan.tasks
                  .slice()
                  .sort((a, b) => a.priority - b.priority)
                  .slice(0, 3)
                  .map((task) => (
                    <li key={task.taskId}>
                      <span>{task.priority}</span>
                      <div>
                        <strong>{task.title}</strong>
                        <small>
                          {runnerLabel(task.targetRunner)} · {task.projectId}
                        </small>
                      </div>
                      {task.targetRunner === "codex_cli" ? (
                        <button
                          className="ghost"
                          disabled={Boolean(vm.busy)}
                          onClick={() => void vm.handleRunCodexForTask(plan, task)}
                          title="An Codex übergeben"
                          type="button"
                        >
                          {vm.busy === "codex-run" ? (
                            <Loader2 className="spin" size={14} />
                          ) : (
                            <PlayCircle size={14} />
                          )}
                          Codex
                        </button>
                      ) : null}
                    </li>
                  ))}
              </ol>
              <footer>
                <button
                  className="secondary"
                  disabled={Boolean(vm.busy)}
                  onClick={() => void vm.handleReviewActionPlan(plan.planId)}
                  type="button"
                >
                  Prüfen
                </button>
                <button
                  className="secondary"
                  disabled={Boolean(vm.busy)}
                  onClick={() => void vm.handleStartActionPlan(plan.planId)}
                  type="button"
                >
                  <PlayCircle size={15} />
                  Tagesplan freigeben
                </button>
                <button
                  className="ghost danger"
                  disabled={Boolean(vm.busy)}
                  onClick={() => void vm.handleRejectActionPlan(plan.planId)}
                  type="button"
                >
                  Ablehnen
                </button>
              </footer>
              <StatusLine good={plan.status === "approved"} text={planStatusLabel(plan.status)} />
            </article>
          ))}
        </div>
      ) : (
        <div className="queue-empty">
          <CheckCircle2 size={18} />
          <div>
            <strong>Keine offenen Action Plans</strong>
            <span>
              Freigegebene oder abgelehnte Pläne findest du in den Aktivitäten. Neue Pläne
              erscheinen hier nach dem nächsten Mistral-Run.
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ProjectBoardPanel({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const groups = vm.boardGroups;
  const totalTasks = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const hasExecuted = groups.some((group) => group.tasks.some((task) => task.status === "executed"));

  return (
    <Panel
      className="queue-panel board-panel"
      id="section-project-board"
      title="Projekt-Board"
      icon={<LayoutGrid size={18} />}
    >
      <div className="queue-summary">
        <div>
          <strong>
            {vm.dailyCount} von {vm.boardDailyLimit}
          </strong>
          <span>Codex-Läufe heute · {vm.boardSelection.length} ausgewählt</span>
        </div>
        <div className="board-head-actions">
          {hasExecuted ? (
            <button
              className="secondary"
              disabled={Boolean(vm.busy) || vm.queueRunning}
              onClick={() => void vm.handleCheckCompletions(true)}
              title="Ausgeführte Aufgaben gegen GitHub prüfen (gemerged → erledigt)"
              type="button"
            >
              {vm.busy === "check-completions" ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
              Merge-Status prüfen
            </button>
          ) : null}
          <button
            className="secondary"
            disabled={Boolean(vm.busy) || vm.queueRunning}
            onClick={vm.handleRefreshActionPlans}
            type="button"
          >
            {vm.busy === "action-plans" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
            Aktualisieren
          </button>
        </div>
      </div>

      {vm.queueRunning ? (
        <div className="board-running">
          <Loader2 className="spin" size={15} />
          <span>Codex-Queue läuft. Aufgaben werden nacheinander ausgeführt.</span>
          <button className="ghost" onClick={vm.handleStopBoardQueue} type="button">
            <StopCircle size={14} /> Stoppen
          </button>
        </div>
      ) : null}

      {totalTasks ? (
        <div className="board-grid">
          {groups.map((group) => {
            const executable = group.tasks.filter(
              (task) =>
                task.selected &&
                task.approved &&
                task.targetRunner === "codex_cli" &&
                task.riskLevel !== "critical" &&
                task.status !== "deferred"
            ).length;
            return (
              <section className="board-column" key={group.projectId}>
                <header className="board-column-head">
                  <div>
                    <strong>{projectLabel(group.projectId)}</strong>
                    <small>{group.tasks.length} Aufgabe(n)</small>
                  </div>
                  <button
                    className="secondary"
                    disabled={
                      Boolean(vm.busy) ||
                      vm.queueRunning ||
                      executable === 0 ||
                      vm.dailyCount >= vm.boardDailyLimit
                    }
                    onClick={() => void vm.handleStartBoardQueue(group.projectId)}
                    title="Ausgewählte Codex-Aufgaben dieses Projekts sequenziell ausführen"
                    type="button"
                  >
                    <PlayCircle size={14} /> Queue starten
                  </button>
                </header>
                <div className="board-column-body">
                  {group.tasks.map((task) => (
                    <BoardTaskCard key={task.taskId} vm={vm} task={task} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="queue-empty">
          <CheckCircle2 size={18} />
          <div>
            <strong>Keine offenen Aufgaben</strong>
            <span>
              Gib in der Action Queue einen Plan frei – seine Aufgaben erscheinen dann hier nach
              Projekt gruppiert und lassen sich einplanen.
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function BoardTaskCard({
  vm,
  task
}: {
  vm: ReturnType<typeof useKatoSyncViewModel>;
  task: BoardTask;
}) {
  const disabled = Boolean(vm.busy) || vm.queueRunning;
  const isCurrent = vm.currentQueueTaskId === task.taskId;
  const canCodex = task.approved && task.targetRunner === "codex_cli" && task.riskLevel !== "critical";
  const plan = vm.actionPlans.find((entry) => entry.planId === task.planId);

  return (
    <article className={`action-plan-card board-task${task.selected ? " selected" : ""}`}>
      <header>
        <div>
          <span className="agent-name">{task.agentName}</span>
          <strong>{task.title}</strong>
          <small>{task.source}</small>
        </div>
        <span className={`status-pill ${task.status}`}>{taskStatusLabel(task.status)}</span>
      </header>
      <div className="board-pills">
        <span className={`risk-pill ${task.riskLevel}`}>{riskLabel(task.riskLevel)}</span>
        <span className="status-pill neutral">{runnerLabel(task.targetRunner)}</span>
        {isCurrent ? (
          <span className="status-pill running">
            <Loader2 className="spin" size={12} /> Läuft
          </span>
        ) : null}
      </div>
      {task.summary ? <p className="board-summary">{task.summary}</p> : null}

      {!task.approved ? (
        <StatusLine good={false} text="Plan in der Action Queue freigeben, um diese Aufgabe auszuführen." />
      ) : null}
      {task.riskLevel === "critical" ? (
        <StatusLine good={false} text="Kritische Aufgabe – nur manuelle Bearbeitung, kein automatischer Codex-Lauf." />
      ) : null}
      {task.status === "executed" ? (
        <StatusLine
          good={false}
          text={task.prUrl ? "Ausgeführt – PR offen, wartet auf Merge." : "Ausgeführt – wartet auf Verifikation."}
        />
      ) : null}
      {task.status === "executed" && task.prUrl ? (
        <div className="board-pr">
          <a href={task.prUrl} target="_blank" rel="noreferrer">
            Pull Request ansehen
          </a>
        </div>
      ) : null}

      <footer className="board-actions">
        {task.status === "executed" ? (
          <>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void vm.handleCheckTaskCompletion(task)}
              title="PR-/Merge-Status prüfen"
              type="button"
            >
              {vm.busy === "check-completions" ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}
              Status prüfen
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void vm.handleMarkTaskDone(task.taskId)}
              title="Manuell als erledigt markieren"
              type="button"
            >
              <CheckCircle2 size={14} /> Erledigt
            </button>
            <button
              className="ghost danger"
              disabled={disabled}
              onClick={() => void vm.handleRejectTask(task.taskId)}
              type="button"
            >
              Verworfen
            </button>
          </>
        ) : task.status === "deferred" ? (
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => void vm.handleResumeTask(task.taskId)}
            type="button"
          >
            <RotateCcw size={14} /> Wieder einplanen
          </button>
        ) : (
          <>
            <button
              className="secondary"
              disabled={disabled || !task.approved}
              onClick={() => vm.handleSelectTask(task.taskId)}
              type="button"
            >
              {task.selected ? <CheckSquare size={14} /> : <Square size={14} />}
              {task.selected ? "Ausgewählt" : "Auswählen"}
            </button>
            {task.selected ? (
              <>
                <button
                  className="ghost"
                  disabled={disabled}
                  onClick={() => vm.handleReorderTask(task.taskId, "up")}
                  title="Nach oben"
                  type="button"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="ghost"
                  disabled={disabled}
                  onClick={() => vm.handleReorderTask(task.taskId, "down")}
                  title="Nach unten"
                  type="button"
                >
                  <ChevronDown size={14} />
                </button>
              </>
            ) : null}
            <button
              className="ghost"
              disabled={disabled}
              onClick={() => void vm.handleDeferTask(task.taskId)}
              type="button"
            >
              Aufschieben
            </button>
            {canCodex && plan ? (
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void vm.handleRunCodexForTask(plan, task)}
                title="An Codex übergeben"
                type="button"
              >
                {vm.busy === "codex-run" ? <Loader2 className="spin" size={14} /> : <PlayCircle size={14} />}
                An Codex übergeben
              </button>
            ) : null}
            <button
              className="ghost danger"
              disabled={disabled}
              onClick={() => void vm.handleRejectTask(task.taskId)}
              type="button"
            >
              Ablehnen
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

function BriefingsPanel({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const visibleBriefings = useMemo(
    () => vm.briefings.filter((briefing) => briefing.status !== "archived"),
    [vm.briefings]
  );
  const [selectedId, setSelectedId] = useState<string | null>(visibleBriefings[0]?.briefingId ?? null);
  const selected = visibleBriefings.find((briefing) => briefing.briefingId === selectedId) ?? visibleBriefings[0];

  useEffect(() => {
    if (!selectedId && visibleBriefings[0]) setSelectedId(visibleBriefings[0].briefingId);
    if (selectedId && !visibleBriefings.some((briefing) => briefing.briefingId === selectedId)) {
      setSelectedId(visibleBriefings[0]?.briefingId ?? null);
    }
  }, [selectedId, visibleBriefings]);

  return (
    <div className="briefings-page" id="section-briefings">
      <Panel className="briefing-list-panel" title="Briefing-Eingang" icon={<BookOpenText size={18} />}>
        <div className="queue-summary">
          <div>
            <strong>{visibleBriefings.filter((briefing) => briefing.status === "new").length}</strong>
            <span>neue Briefings</span>
          </div>
          <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleRefreshBriefings} type="button">
            {vm.busy === "briefings" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
            Aktualisieren
          </button>
        </div>

        <div className="briefing-list">
          {visibleBriefings.length ? (
            visibleBriefings.map((briefing) => (
              <button
                className={selected?.briefingId === briefing.briefingId ? "briefing-card active" : "briefing-card"}
                key={briefing.briefingId}
                onClick={() => setSelectedId(briefing.briefingId)}
                type="button"
              >
                <span className="agent-name">{briefing.agentName}</span>
                <strong>{briefing.title}</strong>
                <small>{briefing.createdAt}</small>
                <div>
                  <span className={`priority-pill ${briefing.priority}`}>{briefingPriorityLabel(briefing.priority)}</span>
                  <span className={`status-pill ${briefing.status}`}>{briefingStatusLabel(briefing.status)}</span>
                </div>
              </button>
            ))
          ) : (
            <div className="queue-empty">
              <CheckCircle2 size={18} />
              <div>
                <strong>Keine Briefings</strong>
                <span>Neue Mistral-Ergebnisse erscheinen hier, sobald der MCP-Rückkanal sie liefert.</span>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel className="briefing-reader-panel">
        {selected ? (
          <article className="briefing-reader">
            <header>
              <div>
                <span className="section-label">{selected.agentName}</span>
                <h2>{selected.title}</h2>
                <p>{selected.createdAt} · {selected.source}</p>
              </div>
              <span className={`priority-pill ${selected.priority}`}>{briefingPriorityLabel(selected.priority)}</span>
            </header>
            <p className="briefing-summary">{selected.summary}</p>
            <div className="briefing-body markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.body}</ReactMarkdown>
            </div>
            {selected.suggestedAction ? (
              <div className="suggested-action">
                <span className="section-label">Vorgeschlagene Aktion</span>
                <p>{selected.suggestedAction}</p>
              </div>
            ) : null}
            <footer className="briefing-actions">
              <button
                className="secondary"
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleAcceptBriefing(selected.briefingId)}
                type="button"
              >
                <CheckCircle2 size={15} />
                Annehmen
              </button>
              <button
                className="primary"
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleRunCodexForBriefing(selected)}
                type="button"
              >
                {vm.busy === "codex-run" ? <Loader2 className="spin" size={15} /> : <PlayCircle size={15} />}
                An Codex übergeben
              </button>
              <button
                className="ghost danger"
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleRejectBriefing(selected.briefingId)}
                type="button"
              >
                Ablehnen
              </button>
            </footer>
            {vm.busy === "codex-run" ? (
              <div className="codex-running">
                <Loader2 className="spin" size={16} />
                <span>Codex läuft …</span>
                <div className="codex-bar" />
              </div>
            ) : null}
          </article>
        ) : (
          <div className="empty-state">Wähle ein Briefing aus der Liste.</div>
        )}
      </Panel>
    </div>
  );
}

function CodexBridgePanel({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const run = vm.codexRun;
  const result = run.result;
  return (
    <Panel className="codex-panel" title="Codex Bridge" icon={<TerminalSquare size={18} />}>
      <p>
        Freigegebene Aufgaben werden lokal von der Codex-CLI ausgeführt — auf einem eigenen Branch
        (von main abgezweigt), mit Auto-Commit. Nichts wird automatisch in main gemergt; du prüfst den
        Branch bzw. Pull Request und mergst selbst.
      </p>
      {vm.config ? (
        <div className="switch-grid" style={{ marginBottom: 6 }}>
          <Toggle
            checked={vm.config.codexAutoPush}
            label="Branch nach Lauf pushen"
            onChange={(checked) => vm.updateConfig("codexAutoPush", checked)}
          />
          <Toggle
            checked={vm.config.codexCreatePr}
            label="Pull Request erstellen"
            onChange={(checked) => vm.updateConfig("codexCreatePr", checked)}
          />
        </div>
      ) : null}
      <p className="field-hint" style={{ marginTop: -2 }}>
        Änderungen an diesen Schaltern erst mit „Einstellungen speichern" übernehmen.
      </p>
      {vm.config && Object.keys(vm.config.projectRepos ?? {}).length ? (
        <div className="project-repo-list">
          <strong className="section-label">Gemerkte Projekt-Ordner</strong>
          {Object.entries(vm.config.projectRepos).map(([projectId, path]) => (
            <div className="project-repo-row" key={projectId}>
              <div>
                <strong>{projectLabel(projectId)}</strong>
                <span className="field-hint">{path}</span>
              </div>
              <button
                className="ghost"
                disabled={Boolean(vm.busy) || vm.queueRunning}
                onClick={() => void vm.handleForgetProjectRepo(projectId)}
                type="button"
              >
                Ordner vergessen
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {run.status === "idle" ? (
        <div className="codex-bridge-list">
          <div>
            <strong>So startest du</strong>
            <span>In der Action Queue „Codex" pro Task, oder in einem Briefing „An Codex übergeben".</span>
          </div>
          <div>
            <strong>Sicherheit</strong>
            <span>Eigener Branch, Sandbox, Audit. Kritische Aufgaben werden nicht automatisch ausgeführt.</span>
          </div>
          <div>
            <strong>Wirtschaftlich</strong>
            <span>Läuft über deinen Codex/ChatGPT-Login — keine zusätzlichen API-Kosten.</span>
          </div>
        </div>
      ) : (
        <div className="codex-run-view">
          <StatusLine
            good={run.status === "completed"}
            text={
              run.status === "running"
                ? "Codex läuft … (kann 1–2 Minuten dauern)"
                : run.status === "completed"
                  ? "Codex-Lauf abgeschlossen."
                  : `Codex-Lauf fehlgeschlagen${run.error ? `: ${run.error}` : ""}.`
            }
          />
          {run.status === "running" ? <div className="codex-bar" style={{ marginTop: 12 }} /> : null}
          {run.status === "running" && vm.codexEvents.length ? (
            <div className="codex-feed">
              {vm.codexEvents.slice(-15).map((event) => (
                <div className="codex-feed-line" key={`${event.taskId}-${event.seq}`}>
                  <span className="codex-feed-label">{event.label}</span>
                  {event.text ? <span className="codex-feed-text">{event.text}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          {result ? (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              <div>
                <strong>Branch:</strong> {result.branch}
              </div>
              {result.commit ? (
                <div>
                  <strong>Commit:</strong> {result.commit.slice(0, 12)}
                </div>
              ) : null}
              <div>
                <strong>Push:</strong>{" "}
                {result.pushed ? "Branch auf GitHub gepusht ✓" : "nicht gepusht (lokal)"}
              </div>
              {result.prUrl ? (
                <div>
                  <strong>Pull Request:</strong>{" "}
                  <a href={result.prUrl} target="_blank" rel="noreferrer">
                    {result.prUrl}
                  </a>
                </div>
              ) : result.branchUrl ? (
                <div>
                  <strong>Branch:</strong>{" "}
                  <a href={result.branchUrl} target="_blank" rel="noreferrer">
                    auf GitHub ansehen
                  </a>
                </div>
              ) : null}
              <div>
                <strong>Run-Ordner:</strong> <span className="field-hint">{result.runDir}</span>
              </div>
              <div>
                <strong>Geänderte Dateien ({result.changedFiles.length}):</strong>
              </div>
              {result.changedFiles.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.changedFiles.slice(0, 40).map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : (
                <span className="field-hint">Keine Dateiänderungen.</span>
              )}
              {result.resultSummary ? (
                <div className="markdown-body" style={{ marginTop: 8 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.resultSummary}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function LoginGate({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const busy = vm.busy === "login" || vm.busy === "register";
  const submit = () => {
    if (mode === "login") void vm.handleLogin();
    else void vm.handleRegister();
  };
  return (
    <div className="login-gate">
      <div className="login-card">
        <div className="login-brand">
          <img alt="" src="/katoos_icon_logo_trans.png" />
          <div>
            <strong>KatoSync</strong>
            <span>Bei deinem KatoOS-Konto anmelden</span>
          </div>
        </div>
        <div className="login-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            Anmelden
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            type="button"
          >
            Registrieren
          </button>
        </div>
        {vm.notice ? <NoticeBar notice={vm.notice} onClose={() => vm.setNotice(null)} /> : null}
        <label>
          E-Mail
          <input
            autoComplete="email"
            onChange={(event) => vm.setLoginEmail(event.target.value)}
            placeholder="du@example.com"
            type="email"
            value={vm.loginEmail}
          />
        </label>
        <label>
          Passwort
          <input
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            onChange={(event) => vm.setLoginPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="••••••••"
            type="password"
            value={vm.loginPassword}
          />
        </label>
        <button
          className="primary login-submit"
          disabled={busy || !vm.loginEmail || !vm.loginPassword}
          onClick={submit}
          type="button"
        >
          {busy ? <Loader2 className="spin" size={16} /> : null}
          {mode === "login" ? "Anmelden" : "Registrieren"}
        </button>
        <p className="login-hint">
          Mit deinem KatoOS-Konto (SSO mit Website/KSP/KAI). Nach der Anmeldung führt dich KatoSync
          durch die Einrichtung.
        </p>
      </div>
    </div>
  );
}

function LicenseDialog({
  accepted,
  checked,
  onAccept,
  onCheckedChange,
  onClose,
  onQuit
}: {
  accepted: boolean;
  checked: boolean;
  onAccept: () => void;
  onCheckedChange: (checked: boolean) => void;
  onClose: () => void;
  onQuit: () => void;
}) {
  return (
    <div className="modal-backdrop license-backdrop" role="presentation">
      <section aria-labelledby="license-title" aria-modal="true" className="license-dialog" role="dialog">
        {accepted ? (
          <button aria-label="Nutzungsvereinbarung schließen" className="icon-button license-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        ) : null}
        <header>
          <img alt="" src="/katoos_icon_logo_trans.png" />
          <div>
            <span className="section-label">KatoSync</span>
            <h2 id="license-title">{licenseAgreement.title}</h2>
            <p>
              {licenseAgreement.provider} · Version {licenseAgreement.version} · Stand {licenseAgreement.updatedAt}
            </p>
          </div>
        </header>
        <div className="license-body">
          <p className="license-intro">{licenseAgreement.intro}</p>
          {licenseAgreement.sections.map((section) => (
            <article key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </article>
          ))}
          <p className="license-contact">Kontakt: {licenseAgreement.contact}</p>
        </div>
        <footer>
          {accepted ? (
            <button className="secondary" onClick={onClose} type="button">
              Schließen
            </button>
          ) : (
            <>
              <label className="license-accept">
                <input checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} type="checkbox" />
                <span>{licenseAgreement.acceptance}</span>
              </label>
              <div className="license-actions">
                <button className="ghost danger" onClick={onQuit} type="button">
                  App beenden
                </button>
                <button className="primary" disabled={!checked} onClick={onAccept} type="button">
                  Akzeptieren und starten
                </button>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function formatPlanTitle(plan: ActionPlan) {
  if (plan.tasks.length === 1) return plan.tasks[0].title;
  return `${plan.tasks.length} Aufgaben aus ${plan.source}`;
}

function planStatusLabel(status: ActionPlan["status"]) {
  switch (status) {
    case "pending_user_review":
      return "Wartet auf lokale Freigabe. Es wird nichts automatisch ausgeführt.";
    case "in_review":
      return "Zur Prüfung markiert. Bitte Aufgaben und Risiko prüfen.";
    case "approved":
      return "Freigegeben. Tasks mit Codex-Runner kannst du an Codex übergeben.";
    case "running":
      return "Codex läuft …";
    case "rejected":
      return "Abgelehnt. Keine lokale Aktion gestartet.";
    case "blocked":
      return "Blockiert. Menschliche Prüfung erforderlich.";
    case "failed":
      return "Fehlgeschlagen. Bitte den Branch prüfen.";
    case "completed":
      return "Abgeschlossen.";
    default:
      return status;
  }
}

function riskLabel(risk: ActionPlan["riskLevel"]) {
  switch (risk) {
    case "low":
      return "Niedrig";
    case "medium":
      return "Mittel";
    case "high":
      return "Hoch";
    case "critical":
      return "Kritisch";
    default:
      return risk;
  }
}

function runnerLabel(runner: ActionPlan["tasks"][number]["targetRunner"]) {
  switch (runner) {
    case "codex_cli":
      return "Codex CLI";
    case "codex_desktop":
      return "Codex Desktop";
    case "kai_desktop":
      return "KAI Desktop";
    case "manual_review":
      return "Manuelle Prüfung";
    default:
      return runner;
  }
}

function briefingStatusLabel(status: Briefing["status"]) {
  switch (status) {
    case "new":
      return "Neu";
    case "accepted":
      return "Angenommen";
    case "queued":
      return "Vorbereitet";
    case "rejected":
      return "Abgelehnt";
    case "archived":
      return "Archiviert";
    default:
      return status;
  }
}

function taskStatusLabel(status: ActionTaskStatus) {
  switch (status) {
    case "pending":
      return "Offen";
    case "queued":
      return "Eingeplant";
    case "running":
      return "Läuft";
    case "executed":
      return "Ausgeführt";
    case "completed":
      return "Erledigt";
    case "rejected":
      return "Abgelehnt";
    case "failed":
      return "Fehlgeschlagen";
    case "deferred":
      return "Aufgeschoben";
    default:
      return status;
  }
}

function projectLabel(projectId: string) {
  if (projectId === NO_PROJECT_ID) return "Ohne Projekt";
  switch (projectId) {
    case "katosync":
      return "KatoSync";
    case "katoos-mcp":
      return "KatoOS MCP";
    case "katoos-web":
      return "KatoOS Web";
    default:
      return projectId;
  }
}

// ===== Maskierung (Token-Reveal + Praesentationsmodus) =====
function maskMiddle(value: string, front: number, back: number) {
  const v = value || "";
  if (v.length <= front + back + 2) return "•".repeat(Math.max(6, v.length));
  return `${v.slice(0, front)}••••••${v.slice(-back)}`;
}

function maskToken(token: string) {
  return maskMiddle(token, 10, 4);
}

function maskId(id: string) {
  return maskMiddle(id, 6, 4);
}

function maskEmail(email: string | null | undefined) {
  const e = email || "";
  const at = e.indexOf("@");
  if (at < 1) return e ? "•".repeat(Math.max(6, e.length)) : "";
  const local = e.slice(0, at);
  const tld = e.slice(at + 1).split(".").pop() || "";
  return `${local.slice(0, 1)}••••@••••.${tld}`;
}

// Connector-Token: nur 1x sichtbar; bei Fenster-Blur/Minimieren/Tab-Wechsel re-maskiert; Praesentation erzwingt Maske.
function TokenReveal({
  token,
  presentation,
  onCopy
}: {
  token: string;
  presentation: boolean;
  onCopy: () => void;
}) {
  const [revealed, setRevealed] = useState(true);
  useEffect(() => {
    const hide = () => setRevealed(false);
    const onVis = () => {
      if (document.hidden) setRevealed(false);
    };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  const show = revealed && !presentation;
  return (
    <div className="token-reveal">
      <input
        readOnly
        value={show ? token : maskToken(token)}
        onBlur={() => setRevealed(false)}
        onFocus={(event) => {
          if (show) event.currentTarget.select();
        }}
      />
      <button
        className="icon-button"
        onClick={() => setRevealed((current) => !current)}
        title={show ? "Verbergen" : "Anzeigen"}
        type="button"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      <button className="secondary" onClick={onCopy} type="button">
        Kopieren
      </button>
    </div>
  );
}

function briefingPriorityLabel(priority: Briefing["priority"]) {
  switch (priority) {
    case "low":
      return "Niedrig";
    case "medium":
      return "Mittel";
    case "high":
      return "Hoch";
    case "critical":
      return "Kritisch";
    default:
      return priority;
  }
}

function OnboardingDialog({
  currentIndex,
  done,
  onBack,
  onClose,
  onDone,
  onNext,
  position
}: {
  currentIndex: number;
  done: boolean;
  onBack: () => void;
  onClose: () => void;
  onDone: () => void;
  onNext: () => void;
  position: OnboardingPosition | null;
}) {
  const step = onboardingSteps[currentIndex];
  const isLast = currentIndex === onboardingSteps.length - 1;
  // Karte erst zeigen, wenn die Position berechnet ist -> kein Teleport-Sprung von rechts/unten.
  const style: CSSProperties = position ? { left: `${position.left}px`, top: `${position.top}px` } : {};

  return (
    <>
      <div className="onboarding-layer" role="presentation" />
      <section
        aria-labelledby="onboarding-title"
        aria-modal="true"
        className={`onboarding-card ${position ? `is-ready placement-${position.placement}` : ""}`}
        role="dialog"
        style={style}
      >
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
        {done ? (
          <div className="onboarding-done" key={currentIndex}>
            <span className="onboarding-done-row">
              <CheckCircle2 className="onboarding-done-check" size={16} />
              {isLast ? "Bereits eingerichtet — fertig" : "Bereits eingerichtet — weiter …"}
            </span>
            <span className="onboarding-advance">
              <span className="onboarding-advance-fill" />
            </span>
          </div>
        ) : null}
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
    </>
  );
}

function getOverlapArea(
  first: { left: number; top: number; right: number; bottom: number },
  second: { left: number; top: number; right: number; bottom: number }
) {
  const horizontal = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const vertical = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return horizontal * vertical;
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
    case "mcp-token":
      return {
        icon: ShieldCheck,
        title: "MCP Token wird gespeichert",
        text: "Der Connector Token wird im macOS-Schlüsselbund gesichert."
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
    case "action-plans":
      return {
        icon: ClipboardList,
        title: "Action Queue wird geladen",
        text: "KatoSync prüft lokale und spätere MCP-Action-Pläne."
      };
    case "briefings":
      return {
        icon: BookOpenText,
        title: "Briefings werden geladen",
        text: "KatoSync prüft neue Mistral-Ergebnisse aus dem Rückkanal."
      };
    default:
      return null;
  }
}

function buildActivities(vm: ReturnType<typeof useKatoSyncViewModel>) {
  const items: Array<{ kind: "ok" | "warn" | "error" | "info"; title: string; text: string }> = [];
  const pendingPlans = vm.actionPlans.filter(isOpenActionPlan).length;
  const approvedPlans = vm.actionPlans.filter((plan) => plan.status === "approved").length;
  const rejectedPlans = vm.actionPlans.filter((plan) => plan.status === "rejected").length;
  const newBriefings = vm.briefings.filter((briefing) => briefing.status === "new").length;
  const queuedBriefings = vm.briefings.filter((briefing) => briefing.status === "queued").length;
  if (pendingPlans) {
    items.push({
      kind: "info",
      title: "Action Queue",
      text: `${pendingPlans} Plan/Pläne warten auf lokale Freigabe.`
    });
  }
  if (approvedPlans) {
    items.push({
      kind: "ok",
      title: "Freigegebene Pläne",
      text: `${approvedPlans} Plan/Pläne freigegeben. Runner-Anbindung folgt im nächsten 2.0-Schnitt.`
    });
  }
  if (rejectedPlans) {
    items.push({
      kind: "warn",
      title: "Abgelehnte Pläne",
      text: `${rejectedPlans} Plan/Pläne abgelehnt. Keine lokale Aktion gestartet.`
    });
  }
  if (newBriefings) {
    items.push({
      kind: "info",
      title: "Neue Briefings",
      text: `${newBriefings} Briefing(s) warten im Rückkanal.`
    });
  }
  if (queuedBriefings) {
    items.push({
      kind: "ok",
      title: "Briefings vorbereitet",
      text: `${queuedBriefings} Briefing(s) sind für die spätere Runner-Übergabe vorbereitet.`
    });
  }
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

function isOpenActionPlan(plan: ActionPlan) {
  return plan.status === "pending_user_review" || plan.status === "in_review";
}

function getIssueCount(vm: ReturnType<typeof useKatoSyncViewModel>) {
  return (vm.scan?.secretWarnings ?? vm.report?.scan.secretWarnings ?? 0) + (vm.report?.errors.length ?? 0);
}

function buildHintSignature(hints: Array<{ kind: "warn" | "error" | "info"; title: string; text: string }>) {
  return hints
    .filter((hint) => hint.kind !== "info")
    .map((hint) => `${hint.kind}:${hint.title}:${hint.text}`)
    .sort()
    .join("|");
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
