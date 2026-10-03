// Created by NMKato Solutions
// Root-Gateway vor beiden Workspaces + kompakter Moduswechsel fuer die Seitenleiste.
// Reine View: der gewaehlte Modus wird von App.tsx gemerkt (lib/workspaceMode.ts).
import { useEffect, useRef } from "react";
import { ArrowRight, BookOpenText, Bot, Workflow } from "lucide-react";
import { useT, type TKey } from "../i18n";
import type { WorkspaceMode } from "../lib/workspaceMode";

const gatewayModes: Array<{
  mode: WorkspaceMode;
  icon: typeof Bot;
  points: TKey[];
}> = [
  {
    mode: "mistral",
    icon: BookOpenText,
    points: ["gateway.mistral.point1", "gateway.mistral.point2", "gateway.mistral.point3"]
  },
  {
    mode: "agentSync",
    icon: Workflow,
    points: ["gateway.agent.point1", "gateway.agent.point2", "gateway.agent.point3"]
  }
];

export function ModeGateway({
  remembered,
  onChoose
}: {
  remembered: WorkspaceMode | null;
  onChoose: (mode: WorkspaceMode) => void;
}) {
  const { t } = useT();
  const rememberedRef = useRef<HTMLButtonElement | null>(null);

  // Zuletzt genutzten Modus fokussieren -> Enter fuehrt direkt hinein.
  useEffect(() => {
    rememberedRef.current?.focus();
  }, []);

  return (
    <div className="mode-gateway">
      <div className="mode-gateway-ambient" aria-hidden="true">
        <span className="orb orb-mistral" />
        <span className="orb orb-agent" />
      </div>
      <main className="mode-gateway-inner" aria-labelledby="mode-gateway-title">
        <header className="mode-gateway-head">
          <img alt="" src="/katoos_icon_logo_trans.png" />
          <span className="section-label">{t("gateway.eyebrow")}</span>
          <h1 id="mode-gateway-title">{t("gateway.title")}</h1>
          <p>{t("gateway.text")}</p>
        </header>
        <div className="mode-gateway-cards">
          {gatewayModes.map(({ mode, icon: Icon, points }) => {
            const isRemembered = remembered === mode;
            const key = mode === "mistral" ? "mistral" : "agent";
            return (
              <button
                className={`mode-card mode-card-${mode}${isRemembered ? " remembered" : ""}`}
                key={mode}
                onClick={() => onChoose(mode)}
                ref={isRemembered ? rememberedRef : undefined}
                type="button"
              >
                <span className="mode-card-glow" aria-hidden="true" />
                <span className="mode-card-top">
                  <span className="mode-card-icon"><Icon size={26} /></span>
                  {isRemembered ? <span className="mode-card-badge">{t("gateway.lastUsed")}</span> : null}
                </span>
                <strong>{t(`gateway.${key}.title` as TKey)}</strong>
                <span className="mode-card-text">{t(`gateway.${key}.text` as TKey)}</span>
                <ul>
                  {points.map((point) => (
                    <li key={point}>{t(point)}</li>
                  ))}
                </ul>
                <span className="mode-card-cta">
                  {t(`gateway.${key}.cta` as TKey)}
                  <ArrowRight size={16} />
                </span>
              </button>
            );
          })}
        </div>
        <p className="mode-gateway-foot">{t("gateway.foot")}</p>
      </main>
    </div>
  );
}

export function ModeSwitch({
  mode,
  onChange
}: {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
}) {
  const { t } = useT();
  return (
    <div className="mode-switch" role="group" aria-label={t("mode.switchAria")}>
      <button
        aria-pressed={mode === "mistral"}
        className={mode === "mistral" ? "active" : ""}
        onClick={() => onChange("mistral")}
        title={t("mode.toMistral")}
        type="button"
      >
        <BookOpenText size={14} />
        <span>{t("mode.mistral")}</span>
      </button>
      <button
        aria-pressed={mode === "agentSync"}
        className={mode === "agentSync" ? "active" : ""}
        onClick={() => onChange("agentSync")}
        title={t("mode.toAgentSync")}
        type="button"
      >
        <Bot size={14} />
        <span>{t("mode.agentSync")}</span>
      </button>
    </div>
  );
}
