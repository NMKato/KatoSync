// Created by NMKato Solutions
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT, type TKey } from "../i18n";
import { remoteMcpOwnerRecovery, type RemoteMcpOwnerSnapshot } from "../lib/remoteMcpOwnerReview";
import { isRemoteMcpCurrentDeviceApproved, parseRemoteMcpDeviceSnapshot, parseRemoteMcpPreparedDeviceReview,
  type RemoteMcpDeviceSnapshot, type RemoteMcpPreparedDeviceReview } from "../lib/remoteMcpDeviceReview";

export function RemoteMcpCurrentDevicePanel({ clientReady, clientGrantId, targetClientId, factors, allowedTools, canInteract,
  refreshEpoch, onReady, onReviewBusy, onChanged }: {
  clientReady: boolean; clientGrantId: string | null; targetClientId: string | null;
  factors: RemoteMcpOwnerSnapshot["factors"]; allowedTools: string[]; canInteract: boolean; refreshEpoch: number;
  onReady: (ready: boolean) => void; onReviewBusy: (busy: boolean) => void; onChanged: () => void;
}) {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<RemoteMcpDeviceSnapshot | null>(null);
  const [review, setReview] = useState<RemoteMcpPreparedDeviceReview | null>(null);
  const [factorId, setFactorId] = useState(""); const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false); const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof remoteMcpOwnerRecovery> | null>(null);
  const [now, setNow] = useState(Date.now());
  const operation = useRef(0); const pending = useRef(false); const alive = useRef(false);
  const reviewId = useRef<string | null>(null);
  const clearReview = () => {
    const id = reviewId.current; reviewId.current = null; setReview(null); setCode("");
    if (id && window.__TAURI_INTERNALS__) void invoke("remote_mcp_owner_cancel_review", { reviewId: id }).catch(() => {});
  };
  const accept = (raw: unknown, epoch: number) => {
    if (!alive.current || operation.current !== epoch) return;
    const checked = parseRemoteMcpDeviceSnapshot(raw);
    if (!checked || checked.targetClient.id !== targetClientId || checked.grantId !== clientGrantId) throw new Error("invalid_current_device");
    setSnapshot(checked); setFailure(null);
  };
  const fail = (cause: unknown, epoch: number) => {
    if (!alive.current || operation.current !== epoch) return;
    clearReview(); setSnapshot(null); setFailure(remoteMcpOwnerRecovery(cause));
  };
  useEffect(() => {
    setFactorId(current => factors.some(factor => factor.id === current) ? current : factors[0]?.id ?? "");
  }, [factors]);
  useEffect(() => {
    alive.current = true; const epoch = ++operation.current; pending.current = false;
    clearReview(); setSnapshot(null); setFailure(null); setLoading(false); setWorking(false);
    onReady(false); onReviewBusy(false);
    if (clientReady && window.__TAURI_INTERNALS__) {
      pending.current = true; setLoading(true);
      void invoke("remote_mcp_owner_device_snapshot").then(raw => accept(raw, epoch)).catch(cause => fail(cause, epoch)).finally(() => {
        if (alive.current && operation.current === epoch) { pending.current = false; setLoading(false); }
      });
    }
    return () => {
      alive.current = false; operation.current++; pending.current = false;
      const id = reviewId.current; reviewId.current = null;
      if (id && window.__TAURI_INTERNALS__) void invoke("remote_mcp_owner_cancel_review", { reviewId: id }).catch(() => {});
      onReady(false); onReviewBusy(false);
    };
    // Read-only verification of exactly this app's existing Keychain registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientReady, clientGrantId, targetClientId, refreshEpoch, onReady, onReviewBusy]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, []);
  useEffect(() => { onReady(clientReady && isRemoteMcpCurrentDeviceApproved(snapshot, now)); }, [snapshot, now, clientReady, onReady]);
  useEffect(() => { onReviewBusy(working || review !== null); }, [working, review, onReviewBusy]);
  useEffect(() => {
    if (review && review.expiresAt <= now) { clearReview(); setFailure("changed"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, now]);

  const prepare = async () => {
    if (!canInteract || pending.current || !snapshot?.canApproveDevice || review || !factors.some(factor => factor.id === factorId)) return;
    const epoch = ++operation.current; pending.current = true; setWorking(true); setCode(""); setFailure(null);
    try {
      const raw = await invoke("remote_mcp_owner_prepare_device_decision", { expectedRevision: snapshot.revision, factorId });
      if (!alive.current || operation.current !== epoch) return;
      const checked = parseRemoteMcpPreparedDeviceReview(raw, { targetClientId: snapshot.targetClient.id,
        deviceId: snapshot.currentDevice.deviceId, fingerprint: snapshot.currentDevice.fingerprint, nowMs: Date.now(), allowedTools });
      if (!checked) throw new Error("invalid_device_review");
      reviewId.current = checked.reviewId; setReview(checked);
    } catch (cause) { fail(cause, epoch); }
    finally { if (alive.current && operation.current === epoch) { pending.current = false; setWorking(false); } }
  };
  const confirm = async () => {
    if (pending.current || !review || review.expiresAt <= Date.now() || !/^\d{6}$/.test(code)) return;
    const epoch = ++operation.current; const id = review.reviewId; const entered = code;
    pending.current = true; setWorking(true); setCode(""); setReview(null); reviewId.current = null; setFailure(null);
    try {
      accept(await invoke("remote_mcp_owner_confirm_device_decision", { reviewId: id, code: entered }), epoch);
      if (alive.current && operation.current === epoch) onChanged();
    } catch (cause) { fail(cause, epoch); }
    finally { setCode(""); if (alive.current && operation.current === epoch) { pending.current = false; setWorking(false); } }
  };
  const ready = clientReady && isRemoteMcpCurrentDeviceApproved(snapshot, now);
  return <section className="remote-mcp-device" aria-label={t("remoteMcp.device.title")}>
    <strong>{t("remoteMcp.device.title")}</strong>
    <p role="status" data-approved={ready ? "yes" : "no"}>
      {t(!clientReady ? "remoteMcp.device.needsClient" : loading ? "remoteMcp.device.loading" : ready ? "remoteMcp.device.approved" : "remoteMcp.device.notApproved")}
    </p>
    {snapshot ? <>
      <dl className="remote-mcp-owner-target">
        <div><dt>{t("remoteMcp.device.currentApp")}</dt><dd>{snapshot.currentDevice.name}</dd></div>
        <div><dt>{t("remoteMcp.device.fingerprint")}</dt><dd><code>{snapshot.currentDevice.fingerprint}</code></dd></div>
      </dl>
      <p>{t("remoteMcp.device.scope")}</p>
      {!review && snapshot.canApproveDevice ? <div className="remote-mcp-owner-actions">
        <label>{t("remoteMcp.owner.factor")}<select value={factorId} disabled={!canInteract || working || loading}
          onChange={event => setFactorId(event.target.value)}>
          {factors.map((factor, index) => <option value={factor.id} key={factor.id}>{factor.friendlyName || t("remoteMcp.owner.factorFallback", { number: index + 1 })}</option>)}
        </select></label>
        <button type="button" className="secondary compact-button" disabled={!canInteract || working || loading || !factorId}
          onClick={() => void prepare()}>{t("remoteMcp.device.review")}</button>
      </div> : null}
    </> : null}
    {review ? <form className="remote-mcp-owner-review" onSubmit={event => { event.preventDefault(); void confirm(); }}>
      <strong>{t("remoteMcp.device.confirmTitle")}</strong>
      <p>{review.currentDevice.name} · {review.targetClient.name}</p>
      <code>{review.currentDevice.fingerprint}</code>
      <p>{t(review.allowedTools.includes("git.status") ? "remoteMcp.owner.gitReadOnlyScope" : "remoteMcp.owner.readOnlyScope")}</p>
      <p>{t("remoteMcp.owner.reviewExpires", { seconds: Math.max(0, Math.ceil((review.expiresAt - now) / 1000)) })}</p>
      <label htmlFor="remote-mcp-device-totp">{t("remoteMcp.owner.code")}</label>
      <input id="remote-mcp-device-totp" type="password" inputMode="numeric" autoComplete="one-time-code"
        value={code} maxLength={6} pattern="[0-9]{6}" required disabled={working}
        onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
      <small>{t("remoteMcp.owner.codeHint")}</small>
      <div className="remote-mcp-owner-actions">
        <button type="submit" className="primary compact-button" disabled={working || !/^\d{6}$/.test(code) || review.expiresAt <= now}>{t("remoteMcp.device.confirm")}</button>
        <button type="button" className="ghost compact-button" disabled={working} onClick={clearReview}>{t("remoteMcp.owner.cancel")}</button>
      </div>
    </form> : null}
    {failure ? <p role="alert">{t(("remoteMcp.owner.error." + failure) as TKey)}</p> : null}
  </section>;
}
