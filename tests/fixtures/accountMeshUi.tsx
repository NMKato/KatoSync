// Created by NMKato Solutions
// Ausschließlich synthetische UI-Daten: keine nativen Aufrufe, Downloads oder Gerätefreigaben.
import React, { useEffect, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, useT } from "../../src/i18n";
import { Bot, Eye, FileText, Gauge, Languages, LogOut, Power, ShieldCheck } from "lucide-react";
import { HoverTip } from "../../src/components/Primitives";
import { AccountMeshContext, type AccountMeshModel } from "../../src/contexts/AccountMeshContext";
import { AccountDevicesCard, AccountDeviceNotifications } from "../../src/components/AccountDevicesCard";
import { ModeGateway, ModeSwitch } from "../../src/components/ModeGateway";
import { LocalBrainInstaller } from "../../src/components/ProviderManager";
import type { AccountNetwork, AccountRuntime } from "../../src/lib/accountMeshContract";
import type { LocalBrainStatus } from "../../src/lib/localBrainCatalog";
import "../../src/styles.css";
import "../../src/experiencePolish.css";

declare global {
  interface Window {
    __meshActions: Array<{ name: string; args: Record<string, unknown> }>;
    __qaSynthetic: true;
  }
}

const params = new URL(location.href).searchParams;
const scene = params.get("scene") || "ready";
const recoveryScene = params.get("recovery") || "";
const recoveryCodes: Record<string, string> = {
  network: "MESH_ACCOUNT_NETWORK_UNAVAILABLE", account: "MESH_ACCOUNT_LOGIN_REQUIRED",
  peer: "MESH_ACCOUNT_PEER_REVOKED", "server-peer": "MESH_ACCOUNT_PEER_REVOKED",
  stale: "MESH_ADMISSION_PEER_REVOKED", unknown: "MESH_SYNTHETIC_UNKNOWN_PRIVATE_VALUE"
};

const lang = params.get("lang") || "de";
const theme = params.get("theme") === "light" ? "light" : "dark";
const initialView = params.get("view") || "devices";
const brainScene = params.get("brain") || "installed";
const longNames = params.get("names") === "long";
document.documentElement.dataset.theme = theme;
document.documentElement.lang = lang;
localStorage.setItem("katosync.lang", lang);
localStorage.setItem("katosync.theme", theme);
window.__meshActions = [];
window.__qaSynthetic = true;

// Feste Beispielzeit hält die Screenshots reproduzierbar; sie ist keine Live-Presence.
const now = Date.UTC(2026, 10, 19, 12, 0);
const own = "20000000-0000-4000-8000-000000000001";
const peer = "20000000-0000-4000-8000-000000000002";
const owner = "10000000-0000-4000-8000-000000000001";
const fp = (byte: string) => Array(16).fill(byte).join("-");
const base: AccountNetwork = {
  ownerId: owner, localDeviceId: own, localFingerprint: fp("11"), localPublicKey: "a".repeat(43),
  mainDeviceId: peer, mainDeviceAvailable: true, accountRevision: 1, accountVerified: true,
  devices: [
    { deviceId: own, ownerUserId: owner,
      displayName: longNames ? "MacBook Air für internationale Projekte und gemeinsame Arbeitsabläufe" : "MacBook Air",
      personaName: null, platformOs: "macos", membershipState: "discovered", fingerprint: fp("11"),
      publicKey: "a".repeat(43), lastSeenAt: new Date(now).toISOString() },
    { deviceId: peer, ownerUserId: owner,
      displayName: longNames ? "StudioMacNordfluegelRedaktionGemeinsameProjektarbeit-ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "Studio Mac",
      personaName: null, platformOs: "macos", membershipState: "discovered", fingerprint: fp("22"),
      publicKey: "b".repeat(43), lastSeenAt: new Date(now - 180000).toISOString() },
    { deviceId: "20000000-0000-4000-8000-000000000003", ownerUserId: owner,
      displayName: longNames ? "Notebook Windows für Recherche, Planung und gemeinsame Präsentationen" : "Notebook Windows",
      personaName: null, platformOs: "windows", membershipState: "discovered", fingerprint: fp("33"),
      publicKey: "c".repeat(43), lastSeenAt: new Date(now - 500000).toISOString() }
  ]
};
if (recoveryScene === "main" || recoveryScene === "server-peer") base.mainDeviceId = own;
if (scene === "empty") base.devices = [base.devices[0]];
if (scene === "setup" || scene === "empty") {
  base.mainDeviceId = null; base.mainDeviceAvailable = false; base.accountRevision = 0;
}
if (scene === "add") {
  base.localDeviceId = null; base.localFingerprint = null; base.localPublicKey = null; base.devices.shift();
}
const proof: NonNullable<AccountMeshModel["review"]> = {
  version: 1, reviewId: "synthetic-visual-review", peerDeviceId: peer, peerFingerprint: fp("22"),
  expectedRevision: 1, expiresAt: now + 180000, proofReady: true
};
const idle: AccountMeshModel["pairing"] = { phase: "idle", session: null, proof: null, issue: null };
const installed = !["uninstalled", "installing", "unsupported"].includes(brainScene);
const initialBrain: LocalBrainStatus = {
  supported: brainScene !== "unsupported", target: "synthetic-macos-arm64",
  ramGb: brainScene === "memory" ? 8 : 16,
  ramFit: brainScene === "unsupported" ? "unsupported" : brainScene === "memory" ? "supported" : "recommended",
  runtimeId: "synthetic-llama-cpp", runtimeVersion: "fixture", runtimeInstalled: installed,
  modelId: "synthetic-model", modelName: "Kato Local Brain · Gemma 4 E4B",
  modelInstalled: installed, modelSizeBytes: 4590000000, quantization: "Q4_0", license: "Apache-2.0",
  sourceRepo: "synthetic/fixture", sourceRevision: "fixture", textReady: installed, codeReady: installed,
  toolsReady: false, audioReady: false, running: brainScene === "running", endpoint: "", modelAlias: "fixture",
  visionReady: false, packageId: "synthetic-local-brain", packageVersion: "fixture", packageChannel: "beta",
  releaseState: "internal", releaseBlockers: [], installedVersion: installed ? "fixture" : null,
  previousVersion: null, pinnedVersion: null, updateState: installed ? "current" : "not_installed"
};

// Echter ModeSwitch und echte Sidebar-Klassen; alle Handlungen bleiben synthetisch.
function SidebarRailExample({ onChoose }: { onChoose: (mode: ComponentProps<typeof ModeSwitch>["mode"]) => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<ComponentProps<typeof ModeSwitch>["mode"]>("agentSync");
  return <div className={`app-shell mode-${mode} qa-sidebar-rail`}>
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><img alt="" src="/katosync_logo_centered.png" /></div>
        <div className="brand-copy"><strong>KatoSync</strong><span>{t("mode.agentSyncTagline")}</span></div>
      </div>
      <ModeSwitch mode={mode} onChange={next => { setMode(next); onChoose(next); }} />
      <nav className="steps" aria-label={t("mode.agentSyncNav")}>
        <button className="step" type="button"><Gauge size={18} /><span>{t("nav.agentDashboard")}</span></button>
        <button className="step active" type="button"><Bot size={18} /><span>{t("nav.agentProviders")}</span></button>
      </nav>
      <div className="sidebar-footer">
        <HoverTip title={t("sidebar.presentation")} description={t("sidebar.presentationDesc")}>
          <button className="ghost license-link" type="button"><Eye size={16} /><span>{t("sidebar.presentation")}</span></button>
        </HoverTip>
        <label className="ghost license-link lang-switch" title={t("sidebar.languageTitle")}>
          <Languages size={16} />
          <select aria-label={t("sidebar.languageTitle")} value={lang} onChange={() => {}}>
            <option value="de">{t("lang.de")}</option><option value="en">{t("lang.en")}</option>
            <option value="es">{t("lang.es")}</option><option value="ru">{t("lang.ru")}</option>
          </select>
        </label>
        <HoverTip title={t("sidebar.license")} description={t("sidebar.licenseDesc")}>
          <button className="ghost license-link" type="button"><FileText size={16} /><span>{t("sidebar.license")}</span></button>
        </HoverTip>
        <div className="sidebar-account">
          <span className="sidebar-account-email" title={t("sidebar.account")}>Synthetisches Beispielkonto</span>
          <span className="sidebar-katoos-family-badge" title={t("auth.katoosFamilyHint")}>
            <ShieldCheck size={12} />{t("auth.katoosFamily")}
          </span>
          <HoverTip title={t("sidebar.logout")} description={t("sidebar.logoutDesc")}>
            <button className="ghost license-link" type="button"><LogOut size={16} /><span>{t("sidebar.logout")}</span></button>
          </HoverTip>
        </div>
        <HoverTip title={t("sidebar.quit")} description={t("sidebar.quitDesc")}>
          <button className="ghost danger compact-danger" type="button"><Power size={16} /><span>{t("sidebar.quit")}</span></button>
        </HoverTip>
        <span className="app-version-label">KatoSync · synthetische Vorschau · Agent Sync</span>
      </div>
    </aside>
    <main className="workspace">
      <div className="qa-synthetic-banner" role="note">SYNTHETISCHE SIDEBAR-PRÜFUNG · KEINE LIVE-AKTIONEN</div>
      <section className="provider-manager"><AccountDevicesCard /></section>
    </main>
  </div>;
}

function Example() {
  const [view, setView] = useState(initialView);
  const [focusDevices, setFocusDevices] = useState(false);
  const [network, setNetwork] = useState(base);
  const [approved, setApproved] = useState(
    ["connected", "offline", "approved"].includes(scene) || recoveryScene ? [fp("22")] : []);
  const [review, setReview] = useState<AccountMeshModel["review"]>(scene === "review" ? proof : null);
  const [reviewOpen, setReviewOpen] = useState(scene === "review");
  const [pairing, setPairing] = useState(idle);
  const [brain, setBrain] = useState(initialBrain);
  const [runtime, setRuntime] = useState<AccountRuntime>({
    ownerId: owner, localDeviceId: own, mainDeviceId: base.mainDeviceId, accountRevision: recoveryScene === "stale" ? base.accountRevision - 1 : base.accountRevision,
    serverState: recoveryScene === "main" ? "blocked" : recoveryScene === "server-peer" ? "listening" : "idle",
    errorCode: recoveryScene === "main" ? "MESH_ACCOUNT_LAN_UNAVAILABLE" : recoveryScene ? "MESH_ACCOUNT_LOGIN_REQUIRED" : null, remoteJobsEnabled: false,
    profiles: scene === "approved" ? [{ peerDeviceId: peer, peerFingerprint: fp("22"), mode: "ask", enabled: false }] : [],
    connections: recoveryScene && recoveryScene !== "main" ? [{
      peerDeviceId: peer, peerFingerprint: fp("22"), role: base.mainDeviceId === own ? "server" : "client", state: "blocked",
      lastHeartbeatAt: null, expiresAt: null, errorCode: recoveryCodes[recoveryScene] ?? null, remoteJobsEnabled: false
    }] : scene === "connected" || scene === "offline" ? [{
      peerDeviceId: peer, peerFingerprint: fp("22"), role: "client", state: scene,
      lastHeartbeatAt: now, expiresAt: now + 180000, errorCode: null, remoteJobsEnabled: false
    }] : []
  });
  const act = (name: string, args: Record<string, unknown> = {}) => { window.__meshActions.push({ name, args }); };
  const model: AccountMeshModel = {
    network, runtime, approved, loading: false, busy: false, issue: null, pairing, review, reviewOpen, now,
    refresh: async () => {
      act("refresh"); setRuntime(current => ({ ...current, profiles: current.profiles.map(profile => ({ ...profile })) }));
    },
    addThisDevice: async () => { act("add"); },
    setPrimary: async (deviceId, expectedRevision) => {
      act("primary", { deviceId, expectedRevision });
      setNetwork(current => ({ ...current, mainDeviceId: deviceId, mainDeviceAvailable: true, accountRevision: expectedRevision + 1 }));
      return true;
    },
    connect: async (peerId, mode) => { act("connect", { peerId, mode }); setReview(proof); setReviewOpen(true); },
    stop: async (peerId) => { act("stop", { peerId }); setRuntime(current => ({ ...current, connections: [] })); },
    setMode: async (peerId, mode) => {
      act("mode", { peerId, mode });
      setRuntime(current => ({ ...current, profiles: current.profiles.map(profile =>
        profile.peerDeviceId === peerId ? { ...profile, mode } : profile) }));
      return true;
    },
    revoke: async (peerId) => {
      act("revoke", { peerId }); setApproved([]);
      setRuntime(current => ({ ...current, profiles: [], connections: [] }));
      return true;
    },
    approve: async (mode) => {
      act("approve", { mode }); setApproved([fp("22")]); setReviewOpen(false); setReview(null);
      setRuntime(current => ({ ...current,
        profiles: [{ peerDeviceId: peer, peerFingerprint: fp("22"), mode, enabled: true }],
        connections: [{ peerDeviceId: peer, peerFingerprint: fp("22"), role: "client", state: "connected",
          lastHeartbeatAt: now, expiresAt: now + 180000, errorCode: null, remoteJobsEnabled: false }]
      }));
    },
    openReview: () => setReviewOpen(true), closeReview: () => setReviewOpen(false),
    cancelPairing: () => setPairing(idle)
  };
  const brainVm: ComponentProps<typeof LocalBrainInstaller>["vm"] = {
    localBrainStatus: brain,
    localBrainProgress: brainScene === "installing" ? {
      phase: "verify", label: "Synthetisches Paket wird geprüft", downloadedBytes: 2845800000,
      totalBytes: 4590000000, percent: 62
    } : null,
    localBrainBusy: brainScene === "installing" ? "install" : null,
    handleInstallLocalBrain: async () => {
      act("brain-install"); setBrain(current => ({ ...current, runtimeInstalled: true, modelInstalled: true }));
    },
    handleStartLocalBrain: async () => { act("brain-start"); setBrain(current => ({ ...current, running: true })); },
    handleStopLocalBrain: async () => { act("brain-stop"); setBrain(current => ({ ...current, running: false })); },
    handleRemoveLocalBrain: async () => {
      act("brain-remove"); setBrain(current => ({ ...current, running: false, runtimeInstalled: false, modelInstalled: false }));
    }
  };
  // Nur der synthetische Callback wird hier dargestellt; die echte App-Navigation benötigt eine eigene Prüfung.
  useEffect(() => {
    if (view === "devices" && focusDevices) document.getElementById("section-account-devices")?.focus();
  }, [view, focusDevices]);
  return <I18nProvider><AccountMeshContext.Provider value={model}>
    {view !== "rail" ? <div className="qa-synthetic-banner" role="note">KATOSYNC · SYNTHETISCHE UI-PRÜFUNG · KEINE LIVE-GERÄTE ODER FREIGABEN</div> : null}
    {view === "rail" ? <SidebarRailExample onChoose={mode => act("choose", { mode })} /> : view === "gateway" ? <ModeGateway remembered={null} onChoose={mode => act("choose", { mode })}
      onOpenDevices={() => { act("view"); setFocusDevices(true); setView("devices"); }} /> :
      <main className="qa-component-workspace provider-manager" data-qa-view={view}>
        {view === "brain" ? <section className="provider-card"><LocalBrainInstaller vm={brainVm} /></section> : <AccountDevicesCard />}
      </main>}
    {view === "devices" ? <AccountDeviceNotifications devicesVisible onOpenDevices={() => act("view")} /> : null}
  </AccountMeshContext.Provider></I18nProvider>;
}

createRoot(document.getElementById("root")!).render(<Example />);
