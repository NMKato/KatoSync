// Created by NMKato Solutions
// Presentation-only connection navigation. No native IPC, auth, approvals or model actions.
import { Cpu, Laptop, ShieldCheck } from "lucide-react";
import { ProviderBrandMark } from "./ProviderBrandMark";
import { providerDisplayState } from "../lib/providerPolicy";
import { useT, type TKey } from "../i18n";
import type { ProviderId, ProviderStatus } from "../types";

type Props = {
  loggedIn: boolean;
  localRunning: boolean;
  statuses: ProviderStatus[];
};
const TARGETS = {
  devices: "#section-account-devices",
  mcp: ".remote-mcp-owner-card",
  codex: ".provider-card-codex",
  claude: ".provider-card-claude",
  local: ".provider-card-local"
} as const;

export function ConnectionCockpit({ loggedIn, localRunning, statuses }: Props) {
  const { t, lang } = useT();
  const words = {
    de: { aria: "Verbindungen auswählen", devices: "Geräte & Mesh", approval: "Client-Freigabe", local: "Lokale KI", running: "Läuft", onDemand: "Bei Bedarf" },
    en: { aria: "Choose connections", devices: "Devices & Mesh", approval: "Client approval", local: "Local AI", running: "Running", onDemand: "On demand" },
    es: { aria: "Elegir conexiones", devices: "Dispositivos y Mesh", approval: "Permiso de cliente", local: "IA local", running: "En ejecución", onDemand: "Bajo demanda" },
    ru: { aria: "Выбор подключений", devices: "Устройства и Mesh", approval: "Доступ клиента", local: "Локальный ИИ", running: "Работает", onDemand: "По запросу" }
  }[lang];
  const statusText = (provider: ProviderId) => {
    const display = providerDisplayState(statuses.find(s => s.provider === provider), provider);
    return t(display === "disabled" ? "providers.state.disconnected" : (`providers.state.${display}` as TKey));
  };
  const tiles = [
    { id: "devices", title: "SmartMesh", detail: words.devices, enabled: loggedIn },
    { id: "mcp", title: "ChatGPT MCP", detail: words.approval, enabled: loggedIn },
    { id: "codex", title: "OpenAI Codex", detail: statusText("codex"), enabled: true },
    { id: "claude", title: "Claude Code", detail: statusText("claude"), enabled: true },
    { id: "local", title: words.local, detail: localRunning ? words.running : words.onDemand, enabled: true }
  ] as const;
  const navigate = (target: string) => {
    // Known, literal targets only. Never treat provider data as a CSS selector or URL.
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return;
    element.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    element.focus({ preventScroll: true });
  };
  return (
    <nav className="connection-cockpit" aria-label={words.aria}>
      {tiles.map(item => (
        <button
          className="connection-cockpit-tile"
          disabled={!item.enabled}
          key={item.id}
          onClick={() => navigate(TARGETS[item.id])}
          type="button"
        >
          <span className="connection-cockpit-icon" aria-hidden="true">
            {item.id === "codex" ? <ProviderBrandMark provider="codex" size="card" />
              : item.id === "claude" ? <ProviderBrandMark provider="claude" size="card" />
              : item.id === "local" ? <Cpu size={24} />
              : item.id === "mcp" ? <ShieldCheck size={24} /> : <Laptop size={24} />}
          </span>
          <strong>{item.title}</strong>
          <span className="connection-cockpit-detail">{item.detail}</span>
        </button>
      ))}
    </nav>
  );
}
