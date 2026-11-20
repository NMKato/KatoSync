// Created by NMKato Solutions
// Synthetic, isolated visual QA. Uses production components but no native bridge.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, useT, type Lang } from "../../src/i18n";
import { ConnectionCockpit, type ConnectionTile } from "../../src/components/ConnectionCockpit";
import { OperationalEvidenceDashboard } from "../../src/components/OperationalEvidenceDashboard";
import type { useKatoSyncViewModel } from "../../src/viewmodels/useKatoSyncViewModel";
import type { ProviderStatus, RegistryProject } from "../../src/types";
import "../../src/styles.css";
import "../../src/experiencePolish.css";
import "../../src/uxCockpit40.css";

declare global {
  interface Window {
    __cockpitActions?: string[];
    __cockpitSynthetic?: boolean;
  }
}

const query = new URLSearchParams(window.location.search);
const lang: Lang = query.get("lang") === "en" ? "en" : query.get("lang") === "es" ? "es" :
  query.get("lang") === "ru" ? "ru" : "de";
document.documentElement.dataset.theme = query.get("theme") === "light" ? "light" : "dark";
document.documentElement.lang = lang;
const presentation = query.get("presentation") === "1";
window.__cockpitActions = [];
window.__cockpitSynthetic = true;
const now = new Date("2026-11-20T07:00:00Z");
const old = new Date("2026-11-19T10:00:00Z");
function status(provider: "codex" | "claude", connected: boolean): ProviderStatus {
  return {
    provider, label: provider === "codex" ? "OpenAI Codex" : "Anthropic Claude",
    state: connected ? "available" : "installed",
    reason: connected ? "ready" : "sign_in_required",
    installed: true, authenticated: connected, available: connected, enabled: true,
    failoverAllowed: true, capabilities: [], checkedAt: now.toISOString(), secretStored: false
  };
}
const project: RegistryProject = {
  id: "project-alpha", name: "Demo-Projekt (synthetisch)", identityKey: "mock",
  aliases: [], rootPath: "/virtual/demo", commonDir: null, remote: null,
  addedAt: old.toISOString(), source: "discovery",
  focus: { status: "active", priority: "P1", autoMode: "inherit", origin: "user", updatedAt: now.toISOString() },
  scan: { scannedAt: now.toISOString(), branch: "test", headSha: "b".repeat(40), headDate: old.toISOString(),
    dirtyCount: 0, worktrees: [], docs: [], manifests: [] },
  verification: null, capsule: null, resolutions: {}
};
const fakeVm = {
  providerStatuses: [status("codex", true), status("claude", false)],
  providerBusy: {},
  providerHistory: [
    { provider: "codex", from: "installed", to: "available", at: old.toISOString() }
  ],
  localBrainStatus: { modelInstalled: true, running: false },
  agentSync: {
    events: [{ id: "mock-event", kind: "state", at: old.toISOString() }],
  },
  projects: { loaded: true, registry: { projects: [project] } },
  handleConnectProvider: (provider: string) => { window.__cockpitActions?.push("connect:" + provider); },
  handleTestProvider: (provider: string) => { window.__cockpitActions?.push("test:" + provider); }
} as unknown as ReturnType<typeof useKatoSyncViewModel>;

function Scene() {
  const { setLang } = useT();
  const [selectedTile, setSelectedTile] = useState<ConnectionTile | null>(null);
  useEffect(() => setLang(lang), [setLang]);
  const copy = { de: "Synthetische Komponentenprüfung – keine echte Verbindung",
    en: "Synthetic component QA – no live connection",
    es: "Prueba sintética – sin conexiones reales",
    ru: "Синтетический тест – без реального подключения" }[lang];
  return (
    <main className="ks40-qa-wrap">
      <div className="ks40-qa-banner" role="note">{copy}</div>
      <button type="button" data-testid="gateway-open-devices" onClick={() => setSelectedTile("devices")}>Gateway Devices (QA)</button>
      <ConnectionCockpit vm={fakeVm} selectedTile={selectedTile} onSelect={setSelectedTile} />
      <OperationalEvidenceDashboard vm={fakeVm} onNavigate={(step) => {
        window.__cockpitActions?.push("navigate:" + step);
      }} presentation={presentation} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nProvider><Scene /></I18nProvider>
);
