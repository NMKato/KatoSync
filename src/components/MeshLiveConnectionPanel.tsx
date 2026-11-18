// Created by NMKato Solutions
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCcw } from "lucide-react";
import { useT, type TKey } from "../i18n";
import {
  hasMeshConnectionActivity, isMeshConnectionLive, meshConnectionRecovery,
  parseMeshConnectionSnapshot, type MeshConnectionRole, type MeshConnectionSnapshot,
} from "../lib/meshConnectionState";

const STATUS_TIMEOUT_MS = 8_000;
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), STATUS_TIMEOUT_MS); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function MeshLiveConnectionPanel({
  enabled, peerFingerprint, peerName, peerLabels, ownFingerprint,
  canStart, preferredServer, refreshEpoch, onSnapshot,
}: {
  enabled: boolean;
  peerFingerprint: string | null;
  peerName: string | null;
  peerLabels: ReadonlyArray<{ fingerprint: string; name: string }>;
  ownFingerprint: string | null;
  canStart: boolean;
  preferredServer: boolean;
  refreshEpoch: number;
  onSnapshot: (snapshot: MeshConnectionSnapshot | null) => void;
}) {
  const { t } = useT();
  const [role, setRole] = useState<MeshConnectionRole>(preferredServer ? "server" : "client");
  const roleChosen = useRef(false);
  const [snapshot, setSnapshot] = useState<MeshConnectionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const operation = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const previousOwner = useRef(ownFingerprint);

  useEffect(() => {
    if (!roleChosen.current) setRole(preferredServer ? "server" : "client");
  }, [preferredServer]);

  const accept = (raw: unknown, generation: number) => {
    if (!mounted.current || generation !== operation.current) return;
    const observed = parseMeshConnectionSnapshot(raw);
    if (!observed) throw new Error("invalid_native_state");
    const checked = observed.state === "connected" && !isMeshConnectionLive(observed, Date.now())
      ? { ...observed, state: "offline" as const } : observed;
    setSnapshot(checked);
    setUnavailable(false); setFailureCode(null);
    onSnapshot(checked);
  };
  const fail = (generation: number, cause?: unknown) => {
    if (!mounted.current || generation !== operation.current) return;
    setFailureCode(typeof cause === "string" && /^MESH_[A-Z0-9_]{1,115}$/.test(cause) ? cause : null);
    setSnapshot(null); setUnavailable(true); onSnapshot(null);
  };

  useEffect(() => {
    mounted.current = true;
    const generation = ++operation.current;
    pending.current = false; setBusy(false); setStopping(false);
    setSnapshot(null); setUnavailable(false); onSnapshot(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const poll = async () => {
      if (!active || !enabled || !window.__TAURI_INTERNALS__) return;
      if (!pending.current) {
        const observedGeneration = operation.current;
        try { accept(await bounded(invoke("mesh_connection_status")), observedGeneration); }
        catch (cause) { fail(observedGeneration, cause); }
      }
      if (active) timer = setTimeout(() => void poll(), 2_000);
    };
    if (enabled) void poll();
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      active = false; mounted.current = false;
      if (timer !== undefined) clearTimeout(timer);
      clearInterval(clock);
      if (operation.current === generation) operation.current++;
    };
    // Native owns the connection; a page refresh only re-observes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshEpoch, onSnapshot]);

  useEffect(() => {
    if (snapshot?.state === "connected" && !isMeshConnectionLive(snapshot, now)) {
      const expired = { ...snapshot, state: "offline" as const };
      setSnapshot(expired); onSnapshot(expired);
    }
  }, [snapshot, now, onSnapshot]);

  useEffect(() => {
    if (snapshot?.role && hasMeshConnectionActivity(snapshot)) {
      setRole(snapshot.role);
      roleChosen.current = true;
    }
  }, [snapshot?.role, snapshot?.state]);

  useEffect(() => {
    const before = previousOwner.current;
    previousOwner.current = ownFingerprint;
    if (!enabled || !before || before === ownFingerprint || !window.__TAURI_INTERNALS__) return;
    // Losing/changing the verified local identity cancels the existing channel.
    const generation = ++operation.current;
    pending.current = true; setBusy(true); setStopping(true);
    setSnapshot(null); onSnapshot(null);
    void bounded(invoke("mesh_connection_stop"))
      .catch(cause => fail(generation, cause))
      .finally(() => {
        if (mounted.current && generation === operation.current) {
          pending.current = false; setBusy(false); setStopping(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownFingerprint, enabled, onSnapshot]);

  const start = async () => {
    if (!enabled || !canStart || !peerFingerprint || pending.current || hasMeshConnectionActivity(snapshot)) return;
    const generation = ++operation.current;
    pending.current = true; setBusy(true); setStopping(false); setUnavailable(false);
    try {
      await bounded(invoke("mesh_connection_start", { peerFingerprint, role }));
      accept(await bounded(invoke("mesh_connection_status")), generation);
    } catch (cause) { fail(generation, cause); }
    finally {
      if (mounted.current && generation === operation.current) { pending.current = false; setBusy(false); }
    }
  };
  const stop = async () => {
    if (!enabled || stopping) return;
    const generation = ++operation.current;
    pending.current = true; setBusy(true); setStopping(true);
    // Immediately remove a green state; the native readback confirms closure.
    setSnapshot(null); onSnapshot(null);
    try {
      await bounded(invoke("mesh_connection_stop"));
      accept(await bounded(invoke("mesh_connection_status")), generation);
    } catch (cause) { fail(generation, cause); }
    finally {
      if (mounted.current && generation === operation.current) { pending.current = false; setBusy(false); setStopping(false); }
    }
  };

  if (!enabled) return null;
  const live = isMeshConnectionLive(snapshot, now);
  const active = hasMeshConnectionActivity(snapshot);
  const activeName = peerLabels.find(peer => peer.fingerprint === snapshot?.peerFingerprint)?.name;
  const recovery = meshConnectionRecovery(snapshot?.errorCode ?? failureCode);
  return <section className="mesh-live-connection" aria-label={t("mesh.connection.heading")}>
    <div className="mesh-live-heading">
      <div>
        <strong>{t("mesh.connection.heading")}</strong>
        <p className="mesh-live-state" data-live={live ? "yes" : "no"} role="status" aria-live="polite">
          {unavailable ? t("mesh.connection.unavailable") :
            t(("mesh.connection.state." + (snapshot?.state ?? "idle")) as TKey)}
        </p>
      </div>
      {active || unavailable || busy ? <button type="button" className="ghost compact-button"
        disabled={stopping} onClick={() => void stop()}>{t("mesh.connection.stop")}</button> : null}
    </div>
    {active && activeName ? <p>{t("mesh.connection.activePeer", { name: activeName })}</p> :
      <p>{peerName ? t("mesh.connection.selectedPeer", { name: peerName }) : t("mesh.connection.choosePeer")}</p>}
    <fieldset className="mesh-live-roles" disabled={busy || active}>
      <legend>{t("mesh.connection.roleHeading")}</legend>
      {(["client", "server"] as const).map(value => <label key={value} data-selected={role === value}>
        <input type="radio" name="mesh-connection-role" value={value} checked={role === value}
          onChange={() => { roleChosen.current = true; setRole(value); }} />
        <span><strong>{t(("mesh.connection.role." + value) as TKey)}</strong>
          <small>{t(("mesh.connection.roleHint." + value) as TKey)}</small></span>
      </label>)}
    </fieldset>
    {active && snapshot?.role ? <p className="mesh-live-hint">
      {t(("mesh.connection.activeRole." + snapshot.role) as TKey)}
    </p> : <p className="mesh-live-hint">{t("mesh.connection.roleInactive")}</p>}
    <div className="mesh-live-actions">
      <button type="button" className="primary compact-button"
        disabled={busy || active || !canStart || !peerFingerprint}
        onClick={() => void start()}>
        {busy ? <RefreshCcw size={15} className="spin" aria-hidden="true" /> : null}
        {t(role === "server" ? "mesh.connection.startServer" : "mesh.connection.startClient")}
      </button>
      <small>{t("mesh.connection.scope")}</small>
    </div>
    {snapshot?.state === "blocked" || snapshot?.state === "offline" || unavailable ||
      (snapshot?.state === "reconnecting" && snapshot.errorCode) ?
      <p className="mesh-live-recovery" role="alert">{t(("mesh.connection.recovery." + recovery) as TKey)}</p> : null}
  </section>;
}
