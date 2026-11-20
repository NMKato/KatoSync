// Created by NMKato Solutions
// Progressive disclosure over the existing, explicitly authorized handlers.
import { ArrowRight, CheckCircle2, CircleHelp, LockKeyhole, Network, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useT, type TKey } from "../i18n";
import { providerDisplayState } from "../lib/providerPolicy";
import { uxCopy } from "../lib/uxCopy40";
import type { ProviderId } from "../types";
import type { useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";
import { ProviderBrandMark } from "./ProviderBrandMark";

type VM = ReturnType<typeof useKatoSyncViewModel>;
export type ConnectionTile = "devices" | "codex" | "claude" | "github" | "mcp" | "local";
const providerKeys: ProviderId[] = ["codex", "claude", "local"];

function focusSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  // scrollIntoView is navigation, not a connection or authorization action.
  target.focus({ preventScroll: true });
}

export function ConnectionCockpit({ vm, connectedDevices = 0, selectedTile, onSelect }: { vm: VM; connectedDevices?: number; selectedTile?: ConnectionTile | null; onSelect?: (tile: ConnectionTile) => void }) {
  const { t, lang } = useT();
  const copy = uxCopy(lang);
  const [localSelected, setLocalSelected] = useState<ConnectionTile | null>(null);
  const selected = selectedTile === undefined ? localSelected : selectedTile;
  const targets: Record<ConnectionTile, string> = {
    devices: "ks40-devices",
    codex: "ks40-provider-codex",
    claude: "ks40-provider-claude",
    github: "ks40-github",
    mcp: "ks40-mcp",
    local: "ks40-provider-local"
  };
  const items: Array<{ key: ConnectionTile; title: string }> = [
    { key: "devices", title: copy.cockpitDevices },
    { key: "codex", title: copy.cockpitCodex },
    { key: "claude", title: copy.cockpitClaude },
    { key: "github", title: copy.cockpitGithub },
    { key: "mcp", title: copy.cockpitMcp },
    { key: "local", title: copy.cockpitLocal }
  ];
  const statusFor = (key: ConnectionTile) => {
    if (key === "devices") return connectedDevices > 0
      ? { text: copy.cockpitMeshConnected + " · " + connectedDevices, tone: "ready" }
      : { text: copy.cockpitRegistered, tone: "neutral" };
    if (key === "github") return { text: copy.cockpitCheck, tone: "neutral" };
    if (key === "mcp") return { text: copy.cockpitReview, tone: "neutral" };
    if (key === "local") return {
      text: vm.localBrainStatus?.running ? copy.cockpitReady
        : vm.localBrainStatus?.modelInstalled ? copy.cockpitLocalHint : copy.cockpitNotVerified,
      tone: vm.localBrainStatus?.running ? "ready" : "neutral"
    };
    const s = vm.providerStatuses.find((item) => item.provider === key);
    const busy = Boolean(vm.providerBusy[key]);
    const display = providerDisplayState(s, key, vm.providerBusy[key] === "connect");
    return {
      text: busy ? copy.cockpitPending : t(("providers.state." + (display === "disabled" ? "disconnected" : display)) as TKey),
      tone: busy ? "busy" : display === "connected" ? "ready" : display === "reauth" || display === "quota" ? "warning" : "neutral"
    };
  };

  const selectedStatus = selected ? statusFor(selected) : null;
  const selectedProvider = selected && providerKeys.includes(selected as ProviderId)
    ? selected as ProviderId : null;
  const providerStatus = selectedProvider ? vm.providerStatuses.find((item) => item.provider === selectedProvider) : null;
  const display = selectedProvider ? providerDisplayState(providerStatus ?? undefined, selectedProvider,
    vm.providerBusy[selectedProvider] === "connect") : null;
  const canConnect = (selectedProvider === "codex" || selectedProvider === "claude")
    && (display === "connect" || display === "reauth" || display === "disabled")
    && providerStatus?.installed === true;
  const canTest = (selectedProvider === "codex" || selectedProvider === "claude")
    && !canConnect && providerStatus?.installed === true;
  const isBusy = selectedProvider ? Boolean(vm.providerBusy[selectedProvider]) : false;

  return (
    <section className="ks40-cockpit" aria-labelledby="ks40-cockpit-title">
      <header className="ks40-section-heading">
        <div>
          <span className="ks40-eyebrow"><Network size={14} /> KatoSync 4.0 Preview</span>
          <h3 id="ks40-cockpit-title">{copy.cockpitTitle}</h3>
          <p>{copy.cockpitHint}</p>
        </div>
      </header>
      <div className="ks40-cockpit-grid" role="group" aria-label={copy.cockpitChoose}>
        {items.map(({ key, title }) => {
          const state = statusFor(key);
          return (
            <button
              aria-controls="ks40-cockpit-active"
              aria-pressed={selected === key}
              className={"ks40-cockpit-tile state-" + state.tone + (selected === key ? " is-selected" : "")}
              key={key}
              onClick={() => { setLocalSelected(key); onSelect?.(key); }}
              type="button"
            >
              <span className="ks40-tile-icon">
                {key === "codex" || key === "claude" || key === "local"
                  ? <ProviderBrandMark provider={key} size="card" />
                  : key === "github" ? <ProviderBrandMark provider="github" size="card" />
                  : key === "devices" ? <Network size={24} /> : <ShieldCheck size={24} />}
              </span>
              <span className="ks40-tile-copy">
                <strong>{title}</strong>
                <small>{state.text}</small>
              </span>
              <span className="ks40-tile-state" aria-hidden="true">
                {state.tone === "ready" ? <CheckCircle2 size={18} /> : state.tone === "warning" ? <LockKeyhole size={17} /> : <CircleHelp size={17} />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ks40-cockpit-detail" id="ks40-cockpit-active" role="region" aria-live="polite">
        {selected && selectedStatus ? (
          <>
            <div className="ks40-cockpit-selection">
              <span className="ks40-eyebrow">{copy.cockpitActive}</span>
              <strong>{items.find((item) => item.key === selected)?.title}</strong>
              <small>{selectedStatus.text}</small>
              <small className="ks40-safe-note">{copy.cockpitNoAutoGrant}</small>
            </div>
            <div className="ks40-cockpit-actions">
              {canConnect ? (
                <button className="primary" disabled={isBusy} type="button"
                  onClick={() => void vm.handleConnectProvider(selectedProvider!, display === "reauth")}>
                  <LockKeyhole size={16} /> {copy.cockpitConnect}
                </button>
              ) : null}
              {canTest ? (
                <button className="secondary" disabled={isBusy} type="button"
                  onClick={() => void vm.handleTestProvider(selectedProvider!)}>
                  <CheckCircle2 size={16} /> {copy.cockpitCheck}
                </button>
              ) : null}
              <button className="secondary" type="button" onClick={() => focusSection(targets[selected])}>
                {selected === "devices" ? copy.cockpitRegistered
                  : selected === "mcp" ? copy.cockpitReview
                  : selected === "github" ? copy.cockpitCheck : copy.cockpitShow}
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        ) : (
          <p className="ks40-cockpit-placeholder">{copy.cockpitChoose}. {copy.cockpitNoAutoGrant}</p>
        )}
      </div>
    </section>
  );
}
