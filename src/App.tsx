import {
  Activity,
  AlertTriangle,
  BookOpenText,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
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
  Languages,
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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FindingsTable,
  NoticeBar,
  Panel,
  StatusLine,
  StepButton,
  Toggle
} from "./components/Primitives";
import { RichMarkdown } from "./components/RichMarkdown";
import { Bars, Donut, KpiTiles, StatusList, Timeline } from "./components/DiagramComponents";
import {
  codexTimeline,
  computeNextRun,
  lastRunKpis,
  newBriefingItems,
  scanBars,
  taskBuckets,
  taskDonut,
  taskKpis,
  uploadDonut
} from "./lib/cockpit";
import { historyBars, loadRunHistory, recordRun, type RunRecord } from "./lib/runHistory";
import { buildSkillPrompt, knownProjectIds, mcpEndpoint, SKILL_CONTRACT_VERSION } from "./lib/skillTemplate";
import { useT, type Lang, type TFunc, type TKey } from "./i18n";
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
  welcome: "section-cockpit",
  api: "section-api",
  library: "section-library",
  folders: "section-folders",
  rules: "section-rules",
  schedule: "section-schedule",
  dashboard: "section-cockpit",
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
  },
  {
    title: "Schritt 6 — Agenten-Skill verbinden",
    text: "Füge unten die Persona deines Agenten ein und drücke „Generieren\". KatoSync ergänzt die nötigen Anweisungen, kopiere das Ergebnis in den Skill deines Agenten.",
    sectionId: "section-skill",
    step: "api"
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

function pageCopy(step: StepId, t: TFunc) {
  const visible = toVisibleStep(step);
  const key =
    visible === "actionQueue" ||
    visible === "projectBoard" ||
    visible === "briefings" ||
    visible === "settings" ||
    visible === "logs"
      ? visible
      : "dashboard";
  return { title: t(`page.${key}.title` as TKey), text: t(`page.${key}.text` as TKey) };
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
  const { t, lang, setLang } = useT();
  const workState = getWorkState(vm.busy, t);
  const WorkIcon = workState?.icon;
  const activities = buildActivities(vm, t);
  const visibleStep = toVisibleStep(vm.activeStep);
  const page = pageCopy(visibleStep, t);
  const issueCount = getIssueCount(vm);
  const hints = buildHints(vm, t);
  const hintSignature = useMemo(() => buildHintSignature(hints), [hints]);
  const hasNewHints = issueCount > 0 && hintSignature !== acknowledgedHintSignature;
  // Skill-Schritt (6): weiches Gate. Erfuellt, sobald der Nutzer einen Skill generiert hat (skillGenerated)
  // ODER die Tour nach abgeschlossenem Setup einmal geschlossen hat (skillSeen, persistent) -> wird NICHT bei jedem
  // Start neu aufgepoppt. Beeinflusst NUR die Tour, nicht das Setup-% / die Nav.
  const [skillGenerated, setSkillGenerated] = useState(
    () => localStorage.getItem("katosync.skill.generated") === "1"
  );
  const [skillSeen, setSkillSeen] = useState(
    () => localStorage.getItem("katosync.onboarding.skillSeen") === "1"
  );
  // Tour-Gates: die 5 Setup-Gates (= Setup-%) plus der weiche Skill-Schritt am Ende.
  const onboardingCompletion = useMemo(
    () => [...vm.setupGates, skillGenerated || skillSeen],
    [vm.setupGates, skillGenerated, skillSeen]
  );
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

  // Verlauf: jeden abgeschlossenen Lauf in den lokalen Run-Ring schreiben (dedupliziert ueber finishedAt).
  // In State gehalten, damit der frisch beendete Lauf sofort im Cockpit erscheint (kein Render-Lag, kein Parse pro Render).
  const [runHistory, setRunHistory] = useState<RunRecord[]>(() => loadRunHistory());
  useEffect(() => {
    if (vm.report?.finishedAt) {
      setRunHistory(recordRun(vm.report));
    }
  }, [vm.report?.finishedAt]);

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
    // Skill-Schritt nur EINMAL zeigen: ist das Config-Setup fertig und die Tour wird geschlossen,
    // dauerhaft als gesehen merken -> kein erneutes Aufpoppen bei jedem Start.
    if (vm.setupGates.every(Boolean)) {
      localStorage.setItem("katosync.onboarding.skillSeen", "1");
      setSkillSeen(true);
    }
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

  // Auto-Advance: ist der aktuelle Schritt erfuellt, gehe strikt EINEN Schritt weiter (1->6, inkl. Skill).
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
      <div className="startup-splash" aria-label={t("shell.preparing")}>
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
        <span>{t("shell.preparing")}</span>
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
              label={t(`nav.${step.id}` as TKey)}
              onClick={() => handleStepSelect(step.id)}
            />
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className={`ghost license-link${presentation ? " is-active" : ""}`}
            onClick={togglePresentation}
            title={presentation ? t("sidebar.presentationTitleOn") : t("sidebar.presentationTitleOff")}
            type="button"
          >
            {presentation ? <EyeOff size={16} /> : <Eye size={16} />}
            <span>{presentation ? t("sidebar.presentationOn") : t("sidebar.presentation")}</span>
          </button>
          <label className="ghost license-link lang-switch" title={t("sidebar.languageTitle")}>
            <Languages size={16} />
            <select
              aria-label={t("sidebar.languageTitle")}
              onChange={(event) => setLang(event.target.value as Lang)}
              value={lang}
            >
              <option value="de">{t("lang.de")}</option>
              <option value="en">{t("lang.en")}</option>
              <option value="es">{t("lang.es")}</option>
              <option value="ru">{t("lang.ru")}</option>
            </select>
          </label>
          <button className="ghost license-link" onClick={() => setLicenseOpen(true)} title={t("sidebar.license")} type="button">
            <FileText size={16} />
            <span>{t("sidebar.license")}</span>
          </button>
          <button className="ghost danger compact-danger" onClick={() => setQuitConfirmOpen(true)} title={t("sidebar.quit")} type="button">
            <Power size={16} />
            <span>{t("sidebar.quit")}</span>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{page.title}</h1>
            <p>{page.text}</p>
          </div>
          <div className="setup-strip" aria-label={t("setup.progressAria")}>
            <div className="completion-head">
              <span>{t("setup.title")}</span>
              <strong>{vm.completion}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${vm.completion}%` }} />
            </div>
            <p>
              {t("setup.keyLabel")} {vm.keyStatus.exists ? t("setup.keySaved") : t("setup.keyMissing")} ·{" "}
              {vm.launchStatus?.installed ? t("setup.planActive") : t("setup.planOpen")}
            </p>
            {hasNewHints ? (
              <button className="issue-badge" onClick={() => setHintsOpen(true)} type="button">
                <span className="issue-count">{issueCount}</span>
                <span className="issue-label">{t("setup.securityHints")}</span>
              </button>
            ) : null}
          </div>
          <div className="top-actions">
            <button
              aria-label={theme === "dark" ? t("topbar.themeLight") : t("topbar.themeDark")}
              aria-pressed={theme === "light"}
              className={`theme-switch ${theme}`}
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? t("topbar.themeLight") : t("topbar.themeDark")}
              type="button"
            >
              <Sun size={15} />
              <Moon size={15} />
              <span className="theme-knob" />
            </button>
            <button
              className={vm.dirty ? "secondary has-unsaved" : "secondary"}
              disabled={Boolean(vm.busy)}
              onClick={vm.persist}
              title={vm.dirty ? t("topbar.unsavedHint") : t("topbar.save")}
              type="button"
            >
              {vm.busy === "save" ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
              {t("topbar.save")}
              {vm.dirty ? <span className="unsaved-dot" aria-hidden="true" /> : null}
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

        {vm.dirty ? (
          <div className="unsaved-banner" role="status" aria-live="polite">
            <AlertTriangle size={16} />
            <span>{t("topbar.unsavedHint")}</span>
            <button className="primary" disabled={Boolean(vm.busy)} onClick={vm.persist} type="button">
              {t("topbar.save")}
            </button>
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
                  <span className="section-label">{t("hint.sectionLabel")}</span>
                  <h2 id="hint-title">{t("hint.title")}</h2>
                  <p>{t("hint.intro")}</p>
                </div>
                <button aria-label={t("hint.close")} className="icon-button" onClick={acknowledgeHints} type="button">
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
                  {t("hint.showFiles")}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    acknowledgeHints();
                    jumpToSection("rules", "section-rules");
                  }}
                  type="button"
                >
                  {t("hint.checkRules")}
                </button>
                <button className="ghost" onClick={acknowledgeHints} type="button">
                  {t("hint.dismiss")}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <section className={`dashboard-grid overview-grid page-${visibleStep}`}>
          {visibleStep === "dashboard" ? <CockpitPanel vm={vm} runHistory={runHistory} /> : null}

          {visibleStep === "settings" ? (
          <Panel className="settings-main-panel" id="section-api" title={t("settings.api.title")} icon={<KeyRound size={18} />}>
            <div
              className={`form-grid ${spotlightId === "section-api-fields" ? "spotlight-target spotlight-pad" : ""}`}
              id="section-api-fields"
            >
              <label
                id="section-api-key"
                className={spotlightId === "section-api-key" ? "spotlight-target spotlight-pad" : ""}
              >
                {t("settings.api.keyLabel")}
                <div className="inline-input">
                  <input
                    onChange={(event) => vm.setKeyInput(event.target.value)}
                    placeholder={vm.keyStatus.masked || "mistral_..."}
                    type="password"
                    value={vm.keyInput}
                  />
                  <button disabled={Boolean(vm.busy)} onClick={vm.handleSaveKey} type="button" title={t("settings.api.saveKeyTitle")}>
                    {vm.busy === "key" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                  </button>
                </div>
              </label>
              <label
                id="section-api-library"
                className={spotlightId === "section-api-library" ? "spotlight-target spotlight-pad" : ""}
              >
                {t("settings.api.libraryIdLabel")}
                <input
                  onChange={(event) => vm.updateConfig("libraryId", event.target.value)}
                  placeholder="mistral-library-id"
                  type={presentation ? "password" : "text"}
                  value={config.libraryId}
                />
              </label>
              <label>
                {t("settings.api.deviceNameLabel")}
                <input
                  onChange={(event) =>
                    vm.updateConfig("device", {
                      ...config.device,
                      deviceName: event.target.value
                    })
                  }
                  placeholder={t("settings.api.deviceNamePlaceholder")}
                  value={config.device.deviceName}
                />
                <span className="field-hint">
                  {t("settings.api.deviceIdLabel")}{" "}
                  {config.device.deviceId
                    ? presentation
                      ? maskId(config.device.deviceId)
                      : config.device.deviceId
                    : t("settings.api.deviceIdAuto")}
                </span>
              </label>
              <label>
                {t("settings.api.mcpServerLabel")}
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
                  {t("settings.api.mcpServerHint", { url: config.mcp.baseUrl.replace(/\/+$/, "") })}
                </span>
              </label>
              <label>
                {t("settings.api.mcpTokenLabel")}
                <div className="inline-input">
                  <input
                    onChange={(event) => vm.setMcpTokenInput(event.target.value)}
                    placeholder={vm.mcpTokenStatus.masked || t("settings.api.mcpTokenPlaceholder")}
                    type="password"
                    value={vm.mcpTokenInput}
                  />
                  <button
                    disabled={Boolean(vm.busy)}
                    onClick={vm.handleSaveMcpConnectorToken}
                    title={t("settings.api.saveMcpTokenTitle")}
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
                {t("settings.api.loginLabel")}
                {vm.sessionStatus.loggedIn ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <span className="field-hint">
                      {t("settings.api.loggedInAs", {
                        email: presentation
                          ? maskEmail(vm.sessionStatus.email)
                          : vm.sessionStatus.email || t("settings.api.accountFallback")
                      })}
                    </span>
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={Boolean(vm.busy)}
                        onClick={vm.handleGenerateConnectorToken}
                        type="button"
                      >
                        {vm.busy === "mint-token" ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                        {vm.busy === "mint-token" ? t("settings.api.generating") : t("settings.api.generateToken")}
                      </button>
                      <button className="ghost" disabled={Boolean(vm.busy)} onClick={vm.handleLogout} type="button">
                        {t("settings.api.logout")}
                      </button>
                    </div>
                    {vm.generatedToken ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <span className="field-hint" style={{ color: "#f59e0b" }}>
                          {t("settings.api.newTokenWarning")}
                        </span>
                        <TokenReveal
                          token={vm.generatedToken}
                          presentation={presentation}
                          onCopy={vm.handleCopyToken}
                        />
                        <span className="field-hint">
                          {t("settings.api.studioHint", { url: config.mcp.baseUrl.replace(/\/+$/, "") })}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      autoComplete="username"
                      onChange={(event) => vm.setLoginEmail(event.target.value)}
                      placeholder={t("settings.api.emailPlaceholder")}
                      type="email"
                      value={vm.loginEmail}
                    />
                    <input
                      autoComplete="current-password"
                      onChange={(event) => vm.setLoginPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") vm.handleLogin();
                      }}
                      placeholder={t("settings.api.passwordPlaceholder")}
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
                        {t("settings.api.login")}
                      </button>
                      <button
                        className="ghost"
                        disabled={Boolean(vm.busy)}
                        onClick={vm.handleRegister}
                        type="button"
                      >
                        {vm.busy === "register" ? <Loader2 className="spin" size={15} /> : null}
                        {t("settings.api.register")}
                      </button>
                    </div>
                  </div>
                )}
                <span className="field-hint">{t("settings.api.loginHint")}</span>
              </label>
            </div>
            <div
              className={`button-row ${spotlightId === "section-api-tests" ? "spotlight-target spotlight-pad" : ""}`}
              id="section-api-tests"
            >
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleTestConnection} type="button">
                {vm.busy === "connection" ? <Loader2 className="spin" size={15} /> : null}
                {vm.busy === "connection" ? t("settings.api.testRunning") : t("settings.api.testConnection")}
              </button>
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleTestLibrary} type="button">
                {vm.busy === "library" ? <Loader2 className="spin" size={15} /> : null}
                {vm.busy === "library" ? t("settings.api.testRunning") : t("settings.api.testLibrary")}
              </button>
              <button className="ghost danger" disabled={Boolean(vm.busy)} onClick={vm.handleDeleteKey} type="button">
                <Trash2 size={15} />
                {t("settings.api.deleteKey")}
              </button>
              <button
                className="ghost danger"
                disabled={Boolean(vm.busy)}
                onClick={vm.handleDeleteMcpConnectorToken}
                type="button"
              >
                <Trash2 size={15} />
                {t("settings.api.deleteMcpToken")}
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
                        {t("settings.quota.remaining", {
                          remaining: metric.remaining ?? t("settings.quota.unknown"),
                          limit: metric.limit ?? t("settings.quota.unknown")
                        })}
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
                <strong>{t("settings.quota.emptyTitle")}</strong>
                <span>{t("settings.quota.emptyText")}</span>
              </div>
            )}
            <p className="field-hint">{t("settings.quota.hint")}</p>
          </Panel>
          ) : null}

          {visibleStep === "settings" ? (
          <Panel
            className={spotlightId === "section-folders" ? "spotlight-target" : ""}
            id="section-folders"
            title={t("settings.folders.title")}
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
                      title={t("settings.folders.removeTitle")}
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">{t("settings.folders.empty")}</div>
              )}
            </div>
            <p className="field-hint">{t("settings.folders.hint")}</p>
            <div className="button-row">
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleChooseFolders} type="button">
                <FolderOpen size={15} />
                {t("settings.folders.choose")}
              </button>
              <button
                className={vm.busy === "scan" ? "secondary busy-action" : "secondary"}
                disabled={Boolean(vm.busy)}
                onClick={vm.handleScan}
                type="button"
              >
                <RefreshCcw className={vm.busy === "scan" ? "spin" : undefined} size={15} />
                {vm.busy === "scan" ? t("settings.folders.scanRunning") : t("settings.folders.scanTest")}
              </button>
            </div>
          </Panel>
          ) : null}

          {visibleStep === "settings" ? (
          <Panel
            className={spotlightId === "section-rules" ? "spotlight-target" : ""}
            id="section-rules"
            title={t("settings.rules.title")}
            icon={<ListChecks size={18} />}
          >
            <div className="switch-grid">
              <Toggle
                checked={config.scanRules.includeMemory}
                label={t("settings.rules.includeMemory")}
                onChange={(checked) => vm.updateNested("scanRules", { includeMemory: checked })}
              />
              <Toggle
                checked={config.scanRules.includeRoadmaps}
                label={t("settings.rules.includeRoadmaps")}
                onChange={(checked) => vm.updateNested("scanRules", { includeRoadmaps: checked })}
              />
              <Toggle
                checked={config.scanRules.includeTasks}
                label={t("settings.rules.includeTasks")}
                onChange={(checked) => vm.updateNested("scanRules", { includeTasks: checked })}
              />
              <Toggle
                checked={config.safety.secretScanEnabled}
                label={t("settings.rules.secretScanner")}
                onChange={(checked) => vm.updateNested("safety", { secretScanEnabled: checked })}
              />
              <Toggle
                checked={config.scanRules.uploadIndividualStatusFiles}
                label={t("settings.rules.individualOptional")}
                onChange={(checked) => vm.updateNested("scanRules", { uploadIndividualStatusFiles: checked })}
              />
            </div>
            <div className="range-row">
              <label>
                {t("settings.rules.maxFileSize")}
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
                {t("settings.rules.individualUploads")}
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
            title={t("settings.schedule.title")}
            icon={<Clock3 size={18} />}
          >
            <div className="schedule-row">
              <Toggle
                checked={config.schedule.enabled}
                label={t("settings.schedule.autoUpload")}
                onChange={(checked) => vm.updateNested("schedule", { enabled: checked })}
              />
              <label>
                {t("settings.schedule.time")}
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
                {vm.busy === "launch" ? t("settings.schedule.installing") : t("settings.schedule.installAgent")}
              </button>
              <button className="ghost" disabled={Boolean(vm.busy)} onClick={vm.handleLaunchRemove} type="button">
                {t("settings.schedule.removeAgent")}
              </button>
            </div>
            <StatusLine
              good={Boolean(vm.launchStatus?.installed && vm.launchStatus.loaded)}
              text={vm.launchStatus?.message || t("settings.schedule.statusUnknown")}
            />
          </Panel>
          ) : null}

          {visibleStep === "dashboard" ? (
          <Panel
            className={`table-panel ${spotlightId === "section-findings" ? "spotlight-target" : ""}`}
            id="section-findings"
            title={t("dashboard.findings.title")}
            icon={<Database size={18} />}
          >
            <FindingsTable scan={vm.scan ?? vm.report?.scan ?? null} />
          </Panel>
          ) : null}

          {visibleStep === "dashboard" ? (
          <Panel className="run-panel" id="section-sync" title={t("dashboard.sync.title")} icon={<UploadCloud size={18} />}>
            <p className="field-hint">
              {config.schedule.enabled ? t("dashboard.sync.hintAuto") : t("dashboard.sync.hintManual")}
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
                  ? t("dashboard.sync.running")
                  : config.schedule.enabled
                    ? t("dashboard.sync.runNowAdditional")
                    : t("dashboard.sync.runNow")}
              </button>
              <button
                className={vm.busy === "dry-run" ? "secondary busy-action" : "secondary"}
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleRun(true)}
                type="button"
              >
                {vm.busy === "dry-run" ? <Loader2 className="spin" size={16} /> : <FileCheck2 size={16} />}
                {vm.busy === "dry-run" ? t("dashboard.sync.dryRunning") : t("dashboard.sync.dryRun")}
              </button>
              <button className="secondary" disabled={Boolean(vm.busy)} onClick={() => void vm.openOutputDir()} type="button">
                {t("dashboard.sync.openOutput")}
              </button>
            </div>
            <StatusLine
              good={!vm.report?.errors.length}
              text={
                vm.report
                  ? t("dashboard.sync.currentFilesCreated", { count: vm.report.currentFiles.length })
                  : t("dashboard.sync.noRun")
              }
            />
          </Panel>
          ) : null}

          {visibleStep === "logs" ? (
          <Panel id="section-activities" className="logs-panel" title={t("logs.title")} icon={<TerminalSquare size={18} />}>
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
                {vm.busy === "logs" ? t("logs.loading") : t("logs.load")}
              </button>
            </div>
            <pre>{vm.logs || t("logs.empty")}</pre>
          </Panel>
          ) : null}

          {visibleStep === "projectBoard" ? <ProjectBoardPanel vm={vm} /> : null}
          {visibleStep === "briefings" ? <BriefingsPanel vm={vm} /> : null}
          {visibleStep === "settings" ? (
            <SkillGeneratorPanel
              vm={vm}
              spotlightId={spotlightId}
              onGenerated={() => setSkillGenerated(true)}
            />
          ) : null}
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
              aria-label={t("app.quit.closeAria")}
              className="icon-button quit-close"
              onClick={() => setQuitConfirmOpen(false)}
              type="button"
            >
              <X size={18} />
            </button>
            <div className="quit-icon">
              <Power size={22} />
            </div>
            <span className="section-label">{t("app.quit.label")}</span>
            <h2 id="quit-title">{t("app.quit.confirmTitle")}</h2>
            <p>{t("app.quit.body1")}</p>
            <p>{t("app.quit.body2")}</p>
            <footer>
              <button className="secondary" onClick={() => setQuitConfirmOpen(false)} type="button">
                {t("app.quit.cancel")}
              </button>
              <button className="ghost danger quit-confirm" onClick={vm.handleQuitApp} type="button">
                <Power size={16} />
                {t("app.quit.confirm")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

// Dashboard-Cockpit: Live-Status + echte Diagramme (wiederverwendete katosync-Bausteine), kein Mock.
function CockpitPanel({
  vm,
  runHistory
}: {
  vm: ReturnType<typeof useKatoSyncViewModel>;
  runHistory: RunRecord[];
}) {
  const { t, lang } = useT();
  const config = vm.config;
  if (!config) return null;

  const work = getWorkState(vm.busy, t);
  const codexRunning = vm.codexRun.status === "running";
  const next = computeNextRun(config.schedule, Boolean(vm.launchStatus?.installed), t, lang);
  const buckets = taskBuckets(vm.actionPlans);
  const feed = codexTimeline(vm.codexEvents);
  const briefingItems = newBriefingItems(vm.briefings, t);
  const runKpis = lastRunKpis(vm.report, t);
  const upload = uploadDonut(vm.report, t);
  const scanByCategory = scanBars(vm.scan ?? vm.report?.scan ?? null, t);
  const history = historyBars(runHistory, lang);

  let liveActive = false;
  let liveTitle = t("cockpit.live.idle.title");
  let liveText = t("cockpit.live.idle.text");
  if (codexRunning) {
    liveActive = true;
    liveTitle = t("cockpit.live.codex.title");
    liveText = vm.codexEvents.length
      ? t("cockpit.live.codex.events", { count: vm.codexEvents.length })
      : t("cockpit.live.codex.running");
  } else if (vm.queueRunning) {
    liveActive = true;
    liveTitle = t("cockpit.live.queue.title");
    liveText = vm.currentQueueTaskId ? t("cockpit.live.queue.task") : t("cockpit.live.queue.active");
  } else if (work) {
    liveActive = true;
    liveTitle = work.title;
    liveText = work.text;
  } else if (vm.report) {
    liveTitle = vm.report.errors.length ? t("cockpit.live.readyHints.title") : t("cockpit.live.ready.title");
    liveText = t("cockpit.live.ready.text", {
      uploads: vm.report.uploaded.length,
      errors: vm.report.errors.length,
      warnings: vm.report.warnings.length
    });
  }

  return (
    <Panel className="cockpit-panel" id="section-cockpit" title={t("cockpit.title")} icon={<LayoutGrid size={18} />}>
      <div className="cockpit-now">
        <div className="cockpit-live">
          <span className={`cockpit-dot ${liveActive ? "on" : "idle"}`} aria-hidden="true" />
          <div>
            <strong>{liveTitle}</strong>
            <span>{liveText}</span>
          </div>
        </div>
        <div className={`cockpit-next ${next.active ? "active" : ""}`}>
          <CalendarClock size={18} />
          <div>
            <strong>{t("cockpit.next.title")}</strong>
            <span>{next.label}</span>
          </div>
        </div>
      </div>

      <div className="cockpit-grid">
        <div className="cockpit-cell">
          {buckets.total > 0 ? (
            <Donut title={t("cockpit.section.tasks")} segments={taskDonut(buckets, t)} />
          ) : (
            <>
              <div className="ks-title">{t("cockpit.section.tasks")}</div>
              <p className="cockpit-empty">{t("cockpit.empty.tasks")}</p>
            </>
          )}
        </div>
        <div className="cockpit-cell">
          <KpiTiles title={t("cockpit.section.work")} items={taskKpis(buckets, vm.dailyCount, t)} />
        </div>

        <div className="cockpit-cell cockpit-cell-wide">
          <div className="ks-title">{t("cockpit.section.feed")}</div>
          {feed.length ? (
            <Timeline items={feed} />
          ) : (
            <p className="cockpit-empty">
              {vm.codexRun.status === "completed" ? t("cockpit.empty.feedDone") : t("cockpit.empty.feedIdle")}
            </p>
          )}
        </div>

        <div className="cockpit-cell">
          {runKpis.length ? (
            <KpiTiles title={t("cockpit.section.lastRun")} items={runKpis} />
          ) : (
            <>
              <div className="ks-title">{t("cockpit.section.lastRun")}</div>
              <p className="cockpit-empty">{t("cockpit.empty.lastRun")}</p>
            </>
          )}
        </div>
        <div className="cockpit-cell">
          {upload.length ? (
            <Donut title={t("cockpit.section.upload")} segments={upload} />
          ) : (
            <>
              <div className="ks-title">{t("cockpit.section.upload")}</div>
              <p className="cockpit-empty">{t("cockpit.empty.upload")}</p>
            </>
          )}
        </div>

        <div className="cockpit-cell">
          <div className="ks-title">{t("cockpit.section.newIn")}</div>
          {briefingItems.length ? (
            <StatusList items={briefingItems} />
          ) : (
            <p className="cockpit-empty">{t("cockpit.empty.newIn")}</p>
          )}
        </div>
        <div className="cockpit-cell">
          {scanByCategory.length ? (
            <Bars title={t("cockpit.section.scanByCategory")} bars={scanByCategory} />
          ) : (
            <>
              <div className="ks-title">{t("cockpit.section.scan")}</div>
              <p className="cockpit-empty">{t("cockpit.empty.scan")}</p>
            </>
          )}
        </div>

        <div className="cockpit-cell cockpit-cell-wide">
          {history.length ? (
            <Bars title={t("cockpit.section.historyBars")} bars={history} />
          ) : (
            <>
              <div className="ks-title">{t("cockpit.section.history")}</div>
              <p className="cockpit-empty">{t("cockpit.empty.history")}</p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ActionQueuePanel({
  vm,
  expanded = false
}: {
  vm: ReturnType<typeof useKatoSyncViewModel>;
  expanded?: boolean;
}) {
  const { t } = useT();
  const visiblePlans = vm.actionPlans.filter(isOpenActionPlan);
  const pendingCount = visiblePlans.length;

  return (
    <Panel
      className={expanded ? "queue-panel action-queue-full" : "queue-panel"}
      id="section-action-queue"
      title={t("queue.title")}
      icon={<ClipboardList size={18} />}
    >
      <div className="queue-summary">
        <div>
          <strong>{pendingCount}</strong>
          <span>{t("queue.pendingLabel")}</span>
        </div>
        <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleRefreshActionPlans} type="button">
          {vm.busy === "action-plans" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
          {t("queue.refresh")}
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
                    {plan.createdAt} ·{" "}
                    {plan.executionMode === "sequential"
                      ? t("queue.executionSequential")
                      : t("queue.executionManual")}
                  </small>
                </div>
                <span className={`risk-pill ${plan.riskLevel}`}>{riskLabel(plan.riskLevel, t)}</span>
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
                          {runnerLabel(task.targetRunner, t)} · {task.projectId}
                        </small>
                      </div>
                      {task.targetRunner === "codex_cli" ? (
                        <button
                          className="ghost"
                          disabled={Boolean(vm.busy)}
                          onClick={() => void vm.handleRunCodexForTask(plan, task)}
                          title={t("queue.handToCodex")}
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
                  {t("queue.review")}
                </button>
                <button
                  className="secondary"
                  disabled={Boolean(vm.busy)}
                  onClick={() => void vm.handleStartActionPlan(plan.planId)}
                  type="button"
                >
                  <PlayCircle size={15} />
                  {t("queue.releaseDayPlan")}
                </button>
                <button
                  className="ghost danger"
                  disabled={Boolean(vm.busy)}
                  onClick={() => void vm.handleRejectActionPlan(plan.planId)}
                  type="button"
                >
                  {t("queue.reject")}
                </button>
              </footer>
              <StatusLine good={plan.status === "approved"} text={planStatusLabel(plan.status, t)} />
            </article>
          ))}
        </div>
      ) : (
        <div className="queue-empty">
          <CheckCircle2 size={18} />
          <div>
            <strong>{t("queue.emptyTitle")}</strong>
            <span>{t("queue.emptyText")}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ProjectBoardPanel({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const { t } = useT();
  const groups = vm.boardGroups;
  const totalTasks = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const hasExecuted = groups.some((group) => group.tasks.some((task) => task.status === "executed"));

  return (
    <Panel
      className="queue-panel board-panel"
      id="section-project-board"
      title={t("board.title")}
      icon={<LayoutGrid size={18} />}
    >
      <div className="queue-summary">
        <div>
          <strong>{t("board.runsCounter", { count: vm.dailyCount, limit: vm.boardDailyLimit })}</strong>
          <span>{t("board.runsToday", { count: vm.boardSelection.length })}</span>
        </div>
        <div className="board-head-actions">
          {hasExecuted ? (
            <button
              className="secondary"
              disabled={Boolean(vm.busy) || vm.queueRunning}
              onClick={() => void vm.handleCheckCompletions(true)}
              title={t("board.checkMergeStatusTitle")}
              type="button"
            >
              {vm.busy === "check-completions" ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
              {t("board.checkMergeStatus")}
            </button>
          ) : null}
          <button
            className="secondary"
            disabled={Boolean(vm.busy) || vm.queueRunning}
            onClick={vm.handleRefreshActionPlans}
            type="button"
          >
            {vm.busy === "action-plans" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
            {t("board.refresh")}
          </button>
        </div>
      </div>

      {vm.queueRunning ? (
        <div className="board-running">
          <Loader2 className="spin" size={15} />
          <span>{t("board.queueRunning")}</span>
          <button className="ghost" onClick={vm.handleStopBoardQueue} type="button">
            <StopCircle size={14} /> {t("board.stop")}
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
                    <strong>{projectLabel(group.projectId, t)}</strong>
                    <small>{t("board.taskCount", { count: group.tasks.length })}</small>
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
                    title={t("board.startQueueTitle")}
                    type="button"
                  >
                    <PlayCircle size={14} /> {t("board.startQueue")}
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
            <strong>{t("board.emptyTitle")}</strong>
            <span>{t("board.emptyHint")}</span>
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
  const { t } = useT();
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
        <span className={`status-pill ${task.status}`}>{taskStatusLabel(task.status, t)}</span>
      </header>
      <div className="board-pills">
        <span className={`risk-pill ${task.riskLevel}`}>{riskLabel(task.riskLevel, t)}</span>
        <span className="status-pill neutral">{runnerLabel(task.targetRunner, t)}</span>
        {isCurrent ? (
          <span className="status-pill running">
            <Loader2 className="spin" size={12} /> {t("board.running")}
          </span>
        ) : null}
      </div>
      {task.summary ? <p className="board-summary">{task.summary}</p> : null}

      {!task.approved ? <StatusLine good={false} text={t("board.statusNeedApproval")} /> : null}
      {task.riskLevel === "critical" ? <StatusLine good={false} text={t("board.statusCritical")} /> : null}
      {task.status === "executed" ? (
        <StatusLine
          good={false}
          text={task.prUrl ? t("board.statusExecutedPrOpen") : t("board.statusExecutedWaiting")}
        />
      ) : null}
      {task.status === "executed" && task.prUrl ? (
        <div className="board-pr">
          <a href={task.prUrl} target="_blank" rel="noreferrer">
            {t("board.viewPullRequest")}
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
              title={t("board.checkStatusTitle")}
              type="button"
            >
              {vm.busy === "check-completions" ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}
              {t("board.checkStatus")}
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void vm.handleMarkTaskDone(task.taskId)}
              title={t("board.markDoneTitle")}
              type="button"
            >
              <CheckCircle2 size={14} /> {t("board.done")}
            </button>
            <button
              className="ghost danger"
              disabled={disabled}
              onClick={() => void vm.handleRejectTask(task.taskId)}
              type="button"
            >
              {t("board.discarded")}
            </button>
          </>
        ) : task.status === "deferred" ? (
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => void vm.handleResumeTask(task.taskId)}
            type="button"
          >
            <RotateCcw size={14} /> {t("board.reschedule")}
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
              {task.selected ? t("board.selected") : t("board.select")}
            </button>
            {task.selected ? (
              <>
                <button
                  className="ghost"
                  disabled={disabled}
                  onClick={() => vm.handleReorderTask(task.taskId, "up")}
                  title={t("board.moveUp")}
                  type="button"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="ghost"
                  disabled={disabled}
                  onClick={() => vm.handleReorderTask(task.taskId, "down")}
                  title={t("board.moveDown")}
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
              {t("board.defer")}
            </button>
            {canCodex && plan ? (
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void vm.handleRunCodexForTask(plan, task)}
                title={t("board.handToCodexTitle")}
                type="button"
              >
                {vm.busy === "codex-run" ? <Loader2 className="spin" size={14} /> : <PlayCircle size={14} />}
                {t("board.handToCodex")}
              </button>
            ) : null}
            <button
              className="ghost danger"
              disabled={disabled}
              onClick={() => void vm.handleRejectTask(task.taskId)}
              type="button"
            >
              {t("board.reject")}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

function BriefingsPanel({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const { t } = useT();
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
      <Panel className="briefing-list-panel" title={t("briefings.inbox.title")} icon={<BookOpenText size={18} />}>
        <div className="queue-summary">
          <div>
            <strong>{visibleBriefings.filter((briefing) => briefing.status === "new").length}</strong>
            <span>{t("briefings.inbox.newCount")}</span>
          </div>
          <button className="secondary" disabled={Boolean(vm.busy)} onClick={vm.handleRefreshBriefings} type="button">
            {vm.busy === "briefings" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
            {t("briefings.inbox.refresh")}
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
                  <span className={`priority-pill ${briefing.priority}`}>{briefingPriorityLabel(briefing.priority, t)}</span>
                  <span className={`status-pill ${briefing.status}`}>{briefingStatusLabel(briefing.status, t)}</span>
                </div>
              </button>
            ))
          ) : (
            <div className="queue-empty">
              <CheckCircle2 size={18} />
              <div>
                <strong>{t("briefings.empty.title")}</strong>
                <span>{t("briefings.empty.hint")}</span>
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
              <span className={`priority-pill ${selected.priority}`}>{briefingPriorityLabel(selected.priority, t)}</span>
            </header>
            <p className="briefing-summary">{selected.summary}</p>
            <div className="briefing-body markdown-body">
              <RichMarkdown>{selected.body}</RichMarkdown>
            </div>
            {selected.suggestedAction ? (
              <div className="suggested-action">
                <span className="section-label">{t("briefings.reader.suggestedAction")}</span>
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
                {t("briefings.reader.accept")}
              </button>
              <button
                className="primary"
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleRunCodexForBriefing(selected)}
                type="button"
              >
                {vm.busy === "codex-run" ? <Loader2 className="spin" size={15} /> : <PlayCircle size={15} />}
                {t("briefings.reader.handToCodex")}
              </button>
              <button
                className="ghost danger"
                disabled={Boolean(vm.busy)}
                onClick={() => void vm.handleRejectBriefing(selected.briefingId)}
                type="button"
              >
                {t("briefings.reader.reject")}
              </button>
            </footer>
            {vm.busy === "codex-run" ? (
              <div className="codex-running">
                <Loader2 className="spin" size={16} />
                <span>{t("briefings.reader.codexRunning")}</span>
                <div className="codex-bar" />
              </div>
            ) : null}
          </article>
        ) : (
          <div className="empty-state">{t("briefings.reader.emptyState")}</div>
        )}
      </Panel>
    </div>
  );
}

function CodexBridgePanel({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const { t } = useT();
  const run = vm.codexRun;
  const result = run.result;
  return (
    <Panel className="codex-panel" title="Codex Bridge" icon={<TerminalSquare size={18} />}>
      <p>{t("codex.intro.description")}</p>
      {vm.config ? (
        <div className="switch-grid" style={{ marginBottom: 6 }}>
          <Toggle
            checked={vm.config.codexAutoPush}
            label={t("codex.toggle.pushBranch")}
            onChange={(checked) => vm.updateConfig("codexAutoPush", checked)}
          />
          <Toggle
            checked={vm.config.codexCreatePr}
            label={t("codex.toggle.createPr")}
            onChange={(checked) => vm.updateConfig("codexCreatePr", checked)}
          />
        </div>
      ) : null}
      <p className="field-hint" style={{ marginTop: -2 }}>
        {t("codex.toggle.saveHint")}
      </p>
      {vm.config && Object.keys(vm.config.projectRepos ?? {}).length ? (
        <div className="project-repo-list">
          <strong className="section-label">{t("codex.projectRepos.title")}</strong>
          {Object.entries(vm.config.projectRepos).map(([projectId, path]) => (
            <div className="project-repo-row" key={projectId}>
              <div>
                <strong>{projectLabel(projectId, t)}</strong>
                <span className="field-hint">{path}</span>
              </div>
              <button
                className="ghost"
                disabled={Boolean(vm.busy) || vm.queueRunning}
                onClick={() => void vm.handleForgetProjectRepo(projectId)}
                type="button"
              >
                {t("codex.projectRepos.forget")}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {run.status === "idle" ? (
        <div className="codex-bridge-list">
          <div>
            <strong>{t("codex.howto.title")}</strong>
            <span>{t("codex.howto.text")}</span>
          </div>
          <div>
            <strong>{t("codex.safety.title")}</strong>
            <span>{t("codex.safety.text")}</span>
          </div>
          <div>
            <strong>{t("codex.economy.title")}</strong>
            <span>{t("codex.economy.text")}</span>
          </div>
        </div>
      ) : (
        <div className="codex-run-view">
          <StatusLine
            good={run.status === "completed"}
            text={
              run.status === "running"
                ? t("codex.status.running")
                : run.status === "completed"
                  ? t("codex.status.completed")
                  : t("codex.status.failed", { error: run.error ? `: ${run.error}` : "" })
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
                <strong>{t("codex.result.branch")}</strong> {result.branch}
              </div>
              {result.commit ? (
                <div>
                  <strong>{t("codex.result.commit")}</strong> {result.commit.slice(0, 12)}
                </div>
              ) : null}
              <div>
                <strong>{t("codex.result.push")}</strong>{" "}
                {result.pushed ? t("codex.result.pushed") : t("codex.result.notPushed")}
              </div>
              {result.prUrl ? (
                <div>
                  <strong>{t("codex.result.pullRequest")}</strong>{" "}
                  <a href={result.prUrl} target="_blank" rel="noreferrer">
                    {result.prUrl}
                  </a>
                </div>
              ) : result.branchUrl ? (
                <div>
                  <strong>{t("codex.result.branch")}</strong>{" "}
                  <a href={result.branchUrl} target="_blank" rel="noreferrer">
                    {t("codex.result.viewOnGithub")}
                  </a>
                </div>
              ) : null}
              <div>
                <strong>{t("codex.result.runDir")}</strong> <span className="field-hint">{result.runDir}</span>
              </div>
              <div>
                <strong>{t("codex.result.changedFiles", { count: result.changedFiles.length })}</strong>
              </div>
              {result.changedFiles.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.changedFiles.slice(0, 40).map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : (
                <span className="field-hint">{t("codex.result.noChanges")}</span>
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

// Skill-Generator: Persona einfuegen -> KatoSync haengt die Integrations-Anweisungen an -> kopieren -> in Mistral-Skill.
function SkillGeneratorPanel({
  vm,
  spotlightId,
  onGenerated
}: {
  vm: ReturnType<typeof useKatoSyncViewModel>;
  spotlightId?: string | null;
  onGenerated?: () => void;
}) {
  const { t } = useT();
  const [persona, setPersona] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const config = vm.config;
  const mcp = mcpEndpoint(config?.mcp.baseUrl ?? "");
  const projects = useMemo(
    () => knownProjectIds(config, vm.boardGroups.map((group) => group.projectId)),
    [config, vm.boardGroups]
  );

  const generate = () => {
    setOutput(buildSkillPrompt(persona, { mcpUrl: config?.mcp.baseUrl ?? "", projects }));
    setCopied(false);
    localStorage.setItem("katosync.skill.generated", "1");
    onGenerated?.();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback (z. B. ohne Clipboard-Permission): Text markieren, damit der Nutzer manuell Cmd+C drueckt.
      outputRef.current?.focus();
      outputRef.current?.select();
    }
  };

  return (
    <Panel
      className={`skill-panel ${spotlightId === "section-skill" ? "spotlight-target" : ""}`}
      id="section-skill"
      title={t("skill.title")}
      icon={<SlidersHorizontal size={18} />}
    >
      <p className="field-hint">{t("skill.intro")}</p>
      <label className="skill-field">
        {t("skill.personaLabel")}
        <textarea
          className="skill-input"
          onChange={(event) => setPersona(event.target.value)}
          placeholder={t("skill.personaPlaceholder")}
          rows={6}
          value={persona}
        />
      </label>
      <div className="button-row">
        <button className="primary" disabled={!persona.trim()} onClick={generate} type="button">
          <SlidersHorizontal size={15} />
          {t("skill.generate")}
        </button>
      </div>
      {output ? (
        <div className="skill-output">
          <div className="skill-output-head">
            <strong className="section-label">{t("skill.outputLabel")}</strong>
            <button className="secondary" onClick={copy} type="button">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t("skill.copied") : t("skill.copy")}
            </button>
          </div>
          <textarea className="skill-input skill-readonly" readOnly ref={outputRef} rows={12} value={output} />
          <p className="field-hint">{t("skill.meta", { version: SKILL_CONTRACT_VERSION, mcp })}</p>
          <p className="field-hint skill-token-note">{t("skill.tokenNote")}</p>
        </div>
      ) : (
        <p className="field-hint">{t("skill.empty")}</p>
      )}
    </Panel>
  );
}

function LoginGate({ vm }: { vm: ReturnType<typeof useKatoSyncViewModel> }) {
  const { t } = useT();
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
            <span>{t("login.subtitle")}</span>
          </div>
        </div>
        <div className="login-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            {t("login.signIn")}
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            type="button"
          >
            {t("login.signUp")}
          </button>
        </div>
        {vm.notice ? <NoticeBar notice={vm.notice} onClose={() => vm.setNotice(null)} /> : null}
        <label>
          {t("login.emailLabel")}
          <input
            autoComplete="email"
            onChange={(event) => vm.setLoginEmail(event.target.value)}
            placeholder={t("login.emailPlaceholder")}
            type="email"
            value={vm.loginEmail}
          />
        </label>
        <label>
          {t("login.passwordLabel")}
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
          {mode === "login" ? t("login.signIn") : t("login.signUp")}
        </button>
        <p className="login-hint">{t("login.hint")}</p>
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
  const { t } = useT();
  return (
    <div className="modal-backdrop license-backdrop" role="presentation">
      <section aria-labelledby="license-title" aria-modal="true" className="license-dialog" role="dialog">
        {accepted ? (
          <button aria-label={t("license.closeAria")} className="icon-button license-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        ) : null}
        <header>
          <img alt="" src="/katoos_icon_logo_trans.png" />
          <div>
            <span className="section-label">KatoSync</span>
            <h2 id="license-title">{licenseAgreement.title}</h2>
            <p>
              {t("license.meta", {
                provider: licenseAgreement.provider,
                version: licenseAgreement.version,
                updatedAt: licenseAgreement.updatedAt
              })}
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
          <p className="license-contact">{t("license.contact")}: {licenseAgreement.contact}</p>
        </div>
        <footer>
          {accepted ? (
            <button className="secondary" onClick={onClose} type="button">
              {t("license.close")}
            </button>
          ) : (
            <>
              <label className="license-accept">
                <input checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} type="checkbox" />
                <span>{licenseAgreement.acceptance}</span>
              </label>
              <div className="license-actions">
                <button className="ghost danger" onClick={onQuit} type="button">
                  {t("license.quit")}
                </button>
                <button className="primary" disabled={!checked} onClick={onAccept} type="button">
                  {t("license.accept")}
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

function planStatusLabel(status: ActionPlan["status"], t: TFunc) {
  switch (status) {
    case "pending_user_review":
      return t("label.planStatus.pendingUserReview");
    case "in_review":
      return t("label.planStatus.inReview");
    case "approved":
      return t("label.planStatus.approved");
    case "running":
      return t("label.planStatus.running");
    case "rejected":
      return t("label.planStatus.rejected");
    case "blocked":
      return t("label.planStatus.blocked");
    case "failed":
      return t("label.planStatus.failed");
    case "completed":
      return t("label.planStatus.completed");
    default:
      return status;
  }
}

function riskLabel(risk: ActionPlan["riskLevel"], t: TFunc) {
  switch (risk) {
    case "low":
      return t("label.risk.low");
    case "medium":
      return t("label.risk.medium");
    case "high":
      return t("label.risk.high");
    case "critical":
      return t("label.risk.critical");
    default:
      return risk;
  }
}

function runnerLabel(runner: ActionPlan["tasks"][number]["targetRunner"], t: TFunc) {
  switch (runner) {
    case "codex_cli":
      return "Codex CLI";
    case "codex_desktop":
      return "Codex Desktop";
    case "kai_desktop":
      return "KAI Desktop";
    case "manual_review":
      return t("label.runner.manualReview");
    default:
      return runner;
  }
}

function briefingStatusLabel(status: Briefing["status"], t: TFunc) {
  switch (status) {
    case "new":
      return t("label.briefingStatus.new");
    case "accepted":
      return t("label.briefingStatus.accepted");
    case "queued":
      return t("label.briefingStatus.queued");
    case "rejected":
      return t("label.briefingStatus.rejected");
    case "archived":
      return t("label.briefingStatus.archived");
    default:
      return status;
  }
}

function taskStatusLabel(status: ActionTaskStatus, t: TFunc) {
  switch (status) {
    case "pending":
      return t("label.taskStatus.pending");
    case "queued":
      return t("label.taskStatus.queued");
    case "running":
      return t("label.taskStatus.running");
    case "executed":
      return t("label.taskStatus.executed");
    case "completed":
      return t("label.taskStatus.completed");
    case "rejected":
      return t("label.briefingStatus.rejected");
    case "failed":
      return t("label.taskStatus.failed");
    case "deferred":
      return t("label.taskStatus.deferred");
    default:
      return status;
  }
}

function projectLabel(projectId: string, t: TFunc) {
  if (projectId === NO_PROJECT_ID) return t("label.project.none");
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
  const { t } = useT();
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
        title={show ? t("label.token.hide") : t("label.token.show")}
        type="button"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      <button className="secondary" onClick={onCopy} type="button">
        {t("label.token.copy")}
      </button>
    </div>
  );
}

function briefingPriorityLabel(priority: Briefing["priority"], t: TFunc) {
  switch (priority) {
    case "low":
      return t("label.priority.low");
    case "medium":
      return t("label.priority.medium");
    case "high":
      return t("label.priority.high");
    case "critical":
      return t("label.priority.critical");
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
  const { t } = useT();
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
        <button aria-label={t("onboarding.close")} className="icon-button onboarding-close" onClick={onClose} type="button">
          <X size={17} />
        </button>
        <div className="onboarding-brand">
          <img alt="" src="/katoos_icon_logo_trans.png" />
          <span>{t("onboarding.brand")}</span>
        </div>
        <div
          className="onboarding-progress"
          aria-label={t("onboarding.progress", { current: currentIndex + 1, total: onboardingSteps.length })}
        >
          {onboardingSteps.map((item, index) => (
            <span className={index <= currentIndex ? "active" : ""} key={item.title} />
          ))}
        </div>
        <h2 id="onboarding-title">{t(`onboarding.step.${currentIndex + 1}.title` as TKey)}</h2>
        <p>{t(`onboarding.step.${currentIndex + 1}.text` as TKey)}</p>
        {done ? (
          <div className="onboarding-done" key={currentIndex}>
            <span className="onboarding-done-row">
              <CheckCircle2 className="onboarding-done-check" size={16} />
              {isLast ? t("onboarding.doneLast") : t("onboarding.doneNext")}
            </span>
            <span className="onboarding-advance">
              <span className="onboarding-advance-fill" />
            </span>
          </div>
        ) : null}
        <footer>
          <button className="ghost" onClick={onDone} type="button">
            {t("onboarding.later")}
          </button>
          <div>
            <button className="secondary" disabled={currentIndex === 0} onClick={onBack} type="button">
              {t("onboarding.back")}
            </button>
            <button className="primary" onClick={onNext} type="button">
              {isLast ? t("onboarding.finish") : t("onboarding.next")}
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

const WORK_STATES: Record<string, { icon: typeof Activity; key: string }> = {
  scan: { icon: RefreshCcw, key: "scan" },
  "dry-run": { icon: FileCheck2, key: "dryRun" },
  sync: { icon: UploadCloud, key: "sync" },
  connection: { icon: KeyRound, key: "connection" },
  library: { icon: Library, key: "library" },
  "mcp-token": { icon: ShieldCheck, key: "mcpToken" },
  save: { icon: CheckCircle2, key: "save" },
  logs: { icon: TerminalSquare, key: "logs" },
  launch: { icon: CalendarClock, key: "launch" },
  "action-plans": { icon: ClipboardList, key: "actionPlans" },
  briefings: { icon: BookOpenText, key: "briefings" }
};

function getWorkState(busy: string | null, t: TFunc) {
  const entry = busy ? WORK_STATES[busy] : undefined;
  if (!entry) return null;
  return {
    icon: entry.icon,
    title: t(`work.${entry.key}.title` as TKey),
    text: t(`work.${entry.key}.text` as TKey)
  };
}

function buildActivities(vm: ReturnType<typeof useKatoSyncViewModel>, t: TFunc) {
  const items: Array<{ kind: "ok" | "warn" | "error" | "info"; title: string; text: string }> = [];
  const pendingPlans = vm.actionPlans.filter(isOpenActionPlan).length;
  const approvedPlans = vm.actionPlans.filter((plan) => plan.status === "approved").length;
  const rejectedPlans = vm.actionPlans.filter((plan) => plan.status === "rejected").length;
  const newBriefings = vm.briefings.filter((briefing) => briefing.status === "new").length;
  const queuedBriefings = vm.briefings.filter((briefing) => briefing.status === "queued").length;
  if (pendingPlans) {
    items.push({
      kind: "info",
      title: t("activity.actionQueue.title"),
      text: t("activity.actionQueue.text", { count: pendingPlans })
    });
  }
  if (approvedPlans) {
    items.push({
      kind: "ok",
      title: t("activity.approvedPlans.title"),
      text: t("activity.approvedPlans.text", { count: approvedPlans })
    });
  }
  if (rejectedPlans) {
    items.push({
      kind: "warn",
      title: t("activity.rejectedPlans.title"),
      text: t("activity.rejectedPlans.text", { count: rejectedPlans })
    });
  }
  if (newBriefings) {
    items.push({
      kind: "info",
      title: t("activity.newBriefings.title"),
      text: t("activity.newBriefings.text", { count: newBriefings })
    });
  }
  if (queuedBriefings) {
    items.push({
      kind: "ok",
      title: t("activity.queuedBriefings.title"),
      text: t("activity.queuedBriefings.text", { count: queuedBriefings })
    });
  }
  if (vm.report) {
    items.push({
      kind: vm.report.errors.length ? "error" : "ok",
      title: vm.report.dryRun ? t("activity.reportDone.dryRun") : t("activity.reportDone.sync"),
      text: t("activity.reportDone.text", {
        currentCount: vm.report.currentFiles.length,
        uploadCount: vm.report.uploaded.length
      })
    });
    if (vm.report.errors.length) {
      items.push({ kind: "error", title: t("activity.errorDetected.title"), text: vm.report.errors[0] });
    }
    if (vm.report.warnings.length) {
      items.push({ kind: "warn", title: t("activity.warning.title"), text: vm.report.warnings[0] });
    }
  }
  if (vm.scan) {
    items.push({
      kind: vm.scan.secretWarnings ? "warn" : "ok",
      title: t("activity.lastScan.title"),
      text: t("activity.lastScan.text", { fileCount: vm.scan.relevantFiles, secretCount: vm.scan.secretWarnings })
    });
  }
  if (vm.launchStatus) {
    items.push({
      kind: vm.launchStatus.installed ? "ok" : "info",
      title: t("activity.uploadPlan.title"),
      text: vm.launchStatus.message
    });
  }
  if (!items.length) {
    items.push({
      kind: "info",
      title: t("activity.empty.title"),
      text: t("activity.empty.text")
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

function buildHints(vm: ReturnType<typeof useKatoSyncViewModel>, t: TFunc) {
  const scan = vm.scan ?? vm.report?.scan ?? null;
  const hints: Array<{ kind: "warn" | "error" | "info"; title: string; text: string }> = [];
  const secretFiles = scan?.findings.filter(isSecretHint) ?? [];

  secretFiles.slice(0, 8).forEach((finding) => {
    hints.push({
      kind: "warn",
      title: t("hintmsg.secretSkipped.title"),
      text: `${finding.relativePath}: ${finding.reason || t("hintmsg.secretSkipped.fallback")}`
    });
  });

  if (scan && scan.secretWarnings > secretFiles.length) {
    hints.push({
      kind: "warn",
      title: t("hintmsg.moreSecrets.title"),
      text: t("hintmsg.moreSecrets.text", { count: scan.secretWarnings - secretFiles.length })
    });
  }

  vm.report?.errors.forEach((error) => {
    hints.push({
      kind: "error",
      title: t("hintmsg.uploadError.title"),
      text: error
    });
  });

  if (!hints.length) {
    hints.push({
      kind: "info",
      title: t("hintmsg.allClean.title"),
      text: t("hintmsg.allClean.text")
    });
  }

  return hints;
}

function isSecretHint(finding: FileFinding) {
  const reason = finding.reason?.toLowerCase() ?? "";
  return finding.skipped && (finding.category === "secret" || reason.includes("secret"));
}
