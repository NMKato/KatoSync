// Created by NMKato Solutions
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT, type TKey } from "../i18n";
import { isRemoteMcpRelayLive, parseRemoteMcpRelaySnapshot, remoteMcpRelayActive,
  type RemoteMcpRelaySnapshot } from "../lib/remoteMcpRelayState";

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("native_timeout")), 8_000);
  })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function RemoteMcpRelayPanel({ canStart, refreshEpoch }: { canStart: boolean; refreshEpoch: number }) {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<RemoteMcpRelaySnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const accept = (raw: unknown, operation: number) => {
    if (!mounted.current || operation !== generation.current) return;
    const observed = parseRemoteMcpRelaySnapshot(raw);
    if (!observed) throw new Error("invalid_presence_receipt");
    setSnapshot(observed.state === "connected" && !isRemoteMcpRelayLive(observed, Date.now())
      ? { ...observed, state: "reconnecting", lastHeartbeatAt: null, expiresAt: null } : observed);
    setUnavailable(false);
  };
  const fail = (operation: number) => {
    if (!mounted.current || operation !== generation.current) return;
    setSnapshot(null); setUnavailable(true);
  };
  useEffect(() => {
    mounted.current = true; generation.current++; pending.current = false;
    setBusy(false); setStopping(false); setSnapshot(null); setUnavailable(false);
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!active || !window.__TAURI_INTERNALS__) return;
      const operation = generation.current;
      if (!pending.current) {
        try { accept(await bounded(invoke("remote_mcp_relay_status")), operation); }
        catch { fail(operation); }
      }
      if (active) timer = setTimeout(() => void poll(), 2_000);
    };
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      active = false; mounted.current = false; generation.current++;
      if (timer !== undefined) clearTimeout(timer); clearInterval(clock);
    };
    // Reopening the page only observes a native user-started connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshEpoch]);
  useEffect(() => {
    if (snapshot?.state === "connected" && !isRemoteMcpRelayLive(snapshot, now)) {
      setSnapshot({ ...snapshot, state: "reconnecting", lastHeartbeatAt: null, expiresAt: null });
    }
  }, [snapshot, now]);
  const command = async (stop: boolean) => {
    if (!window.__TAURI_INTERNALS__ || (stop ? stopping : pending.current || !canStart || remoteMcpRelayActive(snapshot))) return;
    const operation = ++generation.current;
    pending.current = true; setBusy(true); setStopping(stop);
    if (stop) setSnapshot(null);
    try {
      await bounded(invoke(stop ? "remote_mcp_relay_stop" : "remote_mcp_relay_start"));
      accept(await bounded(invoke("remote_mcp_relay_status")), operation);
    } catch { fail(operation); }
    finally {
      if (mounted.current && operation === generation.current) {
        pending.current = false; setBusy(false); setStopping(false);
      }
    }
  };
  const live = isRemoteMcpRelayLive(snapshot, now);
  const active = remoteMcpRelayActive(snapshot);
  return <section className="remote-mcp-relay" aria-label={t("remoteMcp.relay.title")}>
    <strong>{t("remoteMcp.relay.title")}</strong>
    <p role="status" aria-live="polite" data-live={live ? "yes" : "no"}>
      {t(("remoteMcp.relay.state." + (unavailable ? "unavailable" : snapshot?.state ?? "idle")) as TKey)}
    </p>
    <p>{t("remoteMcp.relay.scope")}</p>
    <div className="remote-mcp-owner-actions">
      <button type="button" className="secondary compact-button" disabled={busy || active || !canStart}
        onClick={() => void command(false)}>{t("remoteMcp.relay.start")}</button>
      {active || busy || unavailable ? <button type="button" className="ghost compact-button" disabled={stopping}
        onClick={() => void command(true)}>{t("remoteMcp.relay.stop")}</button> : null}
    </div>
    {!canStart && !active ? <small>{t("remoteMcp.relay.needsClient")}</small> : null}
    {unavailable || snapshot?.state === "blocked" || (snapshot?.state === "reconnecting" && snapshot.errorCode)
      ? <p role="alert">{t("remoteMcp.relay.recovery")}</p> : null}
  </section>;
}
