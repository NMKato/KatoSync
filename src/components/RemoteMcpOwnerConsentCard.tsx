// Created by NMKato Solutions
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { useT, type TKey } from "../i18n";
import { RemoteMcpRelayPanel } from "./RemoteMcpRelayPanel";
import { RemoteMcpCurrentDevicePanel } from "./RemoteMcpCurrentDevicePanel";
import { RemoteMcpMfaEnrollmentPanel } from "./RemoteMcpMfaEnrollmentPanel";
import { parseRemoteMcpOwnerSnapshot, parseRemoteMcpPreparedReview, remoteMcpOwnerRecovery,
  type RemoteMcpDecision, type RemoteMcpOwnerSnapshot, type RemoteMcpPreparedReview } from "../lib/remoteMcpOwnerReview";

export function RemoteMcpOwnerConsentCard({ refreshEpoch = 0 }: { refreshEpoch?: number }) {
  const { t } = useT();
  const enabled = import.meta.env.VITE_KATOOS_AUTH_QA === "1";
  const [snapshot, setSnapshot] = useState<RemoteMcpOwnerSnapshot | null>(null);
  const [review, setReview] = useState<RemoteMcpPreparedReview | null>(null);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceReviewBusy, setDeviceReviewBusy] = useState(false);
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof remoteMcpOwnerRecovery> | null>(null);
  const [notice, setNotice] = useState<"requested" | "approved" | "revoked" | null>(null);
  const [includeGitStatus, setIncludeGitStatus] = useState(false);
  const [includeTerminalProfiles, setIncludeTerminalProfiles] = useState(false);
  const [terminalReviewBusy, setTerminalReviewBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const reviewId = useRef<string | null>(null);

  const clearReview = useCallback(() => {
    const id = reviewId.current;
    reviewId.current = null; setReview(null); setCode("");
    if (id && window.__TAURI_INTERNALS__) {
      void invoke("remote_mcp_owner_cancel_review", { reviewId: id }).catch(() => {});
    }
  }, []);
  const acceptSnapshot = (raw: unknown, operation: number) => {
    if (!mounted.current || operation !== generation.current) return;
    const observed = parseRemoteMcpOwnerSnapshot(raw);
    if (!observed) throw new Error("invalid_native_receipt");
    setSnapshot(observed);
    setFactorId(current => observed.factors.some(factor => factor.id === current)
      ? current : observed.factors[0]?.id ?? "");
    setFailure(null);
  };
  const fail = (cause: unknown, operation: number) => {
    if (!mounted.current || operation !== generation.current) return;
    clearReview(); setSnapshot(null); setFailure(remoteMcpOwnerRecovery(cause));
  };
  const refresh = async () => {
    if (!enabled || !window.__TAURI_INTERNALS__ || pending.current) return;
    const operation = ++generation.current;
    pending.current = true; setBusy(true); setNotice(null); setFailure(null);
    clearReview(); setSnapshot(null);
    try { acceptSnapshot(await invoke("remote_mcp_owner_snapshot"), operation); }
    catch (cause) { fail(cause, operation); }
    finally {
      if (mounted.current && generation.current === operation) { pending.current = false; setBusy(false); }
    }
  };

  useEffect(() => {
    mounted.current = true; pending.current = false;
    void refresh();
    return () => {
      mounted.current = false; generation.current++; pending.current = false;
      const id = reviewId.current; reviewId.current = null;
      if (id && window.__TAURI_INTERNALS__) {
        void invoke("remote_mcp_owner_cancel_review", { reviewId: id }).catch(() => {});
      }
    };
    // An account-keyed parent remount and native auth generation fence stale owner work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshEpoch]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), review ? 1_000 : 60_000);
    return () => clearInterval(timer);
  }, [enabled, review?.reviewId]);
  useEffect(() => {
    if (review && review.expiresAt <= now) {
      clearReview(); setFailure("changed");
    }
  }, [review, now, clearReview]);

  const requestClient = async () => {
    if (pending.current || deviceReviewBusy || enrollmentBusy || !snapshot?.canRequestClient || review) return;
    const operation = ++generation.current;
    pending.current = true; setBusy(true); setNotice(null); setFailure(null);
    try {
      acceptSnapshot(await invoke("remote_mcp_owner_request_client", { includeGitStatus, includeTerminalProfiles }), operation);
      if (mounted.current && operation === generation.current) setNotice("requested");
    } catch (cause) { fail(cause, operation); }
    finally {
      if (mounted.current && operation === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  const prepare = async (action: RemoteMcpDecision) => {
    if (pending.current || deviceReviewBusy || enrollmentBusy || !snapshot?.clientGrant || !snapshot.revision || review ||
        !snapshot.factors.some(factor => factor.id === factorId) ||
        !(action === "approve_client" ? snapshot.canApprove : snapshot.canRevoke)) return;
    const operation = ++generation.current;
    pending.current = true; setBusy(true); setCode(""); setNotice(null); setFailure(null);
    try {
      const raw = await invoke("remote_mcp_owner_prepare_decision", {
        action, grantId: snapshot.clientGrant.id, expectedRevision: snapshot.revision, factorId,
      });
      if (!mounted.current || operation !== generation.current) return;
      const checked = parseRemoteMcpPreparedReview(raw, {
        action, targetClientId: snapshot.targetClient.id, nowMs: Date.now(), allowedTools: snapshot.allowedTools,
      });
      if (!checked) throw new Error("invalid_native_receipt");
      reviewId.current = checked.reviewId; setReview(checked);
    } catch (cause) { fail(cause, operation); }
    finally {
      if (mounted.current && operation === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  const confirm = async () => {
    if (pending.current || !review || review.expiresAt <= Date.now() || !/^\d{6}$/.test(code)) return;
    const operation = ++generation.current;
    const currentReview = review;
    const enteredCode = code;
    // OTP is transient and cleared before any network result or rerender.
    setCode(""); setReview(null); reviewId.current = null;
    pending.current = true; setBusy(true); setNotice(null); setFailure(null);
    try {
      acceptSnapshot(await invoke("remote_mcp_owner_confirm_decision", {
        reviewId: currentReview.reviewId, code: enteredCode,
      }), operation);
      if (mounted.current && operation === generation.current) {
        setNotice(currentReview.action === "approve_client" ? "approved" : "revoked");
      }
    } catch (cause) { fail(cause, operation); }
    finally {
      setCode("");
      if (mounted.current && operation === generation.current) { pending.current = false; setBusy(false); }
    }
  };

  if (!enabled) return null;
  const grantExpired = !!snapshot?.clientGrant && Date.parse(snapshot.clientGrant.expiresAt) <= now;
  const childBusy = deviceReviewBusy || enrollmentBusy || terminalReviewBusy;
  const clientReady = snapshot?.clientGrant?.status === "approved" && !grantExpired;
  const status = !snapshot ? busy ? "loading" : "unavailable" : grantExpired ? "expired" :
    snapshot.clientGrant?.status === "approved" ? "approved" : snapshot.clientGrant ? "pending" : "notRequested";
  return <section className="remote-mcp-owner-card glass" aria-label={t("remoteMcp.owner.title")} tabIndex={-1}>
    <div className="remote-mcp-owner-heading">
      <div><ShieldCheck size={19} aria-hidden="true" /><strong>{t("remoteMcp.owner.title")}</strong></div>
      <button className="ghost compact-button" type="button" disabled={busy || !!review || childBusy}
        onClick={() => void refresh()} aria-label={t("remoteMcp.owner.refresh")}>
        <RefreshCcw size={16} className={busy ? "spin" : ""} />{t("remoteMcp.owner.refresh")}
      </button>
    </div>
    <p className="remote-mcp-owner-state" role="status" aria-live="polite">
      {t(("remoteMcp.owner.state." + status) as TKey)}
    </p>
    <p>{t("remoteMcp.owner.intro")}</p>
    {snapshot ? <>
      <dl className="remote-mcp-owner-target">
        <div><dt>{t("remoteMcp.owner.target")}</dt><dd>{snapshot.targetClient.name}<small>{snapshot.targetClient.id}</small></dd></div>
        <div><dt>{t("remoteMcp.owner.permissions")}</dt><dd>{t(snapshot.allowedTools.includes("terminal.run_profile") ? "remoteMcp.owner.profileScope" : snapshot.allowedTools.includes("git.status") ? "remoteMcp.owner.gitReadOnlyScope" : "remoteMcp.owner.readOnlyScope")}</dd></div>
      </dl>
      <p className="remote-mcp-owner-boundary">{t("remoteMcp.owner.deviceBoundary")}</p>
      {!review ? <div className="remote-mcp-owner-actions">
        {snapshot.canRequestClient ? <>
          <label className="remote-mcp-git-opt-in"><input type="checkbox" checked={includeGitStatus} disabled={busy || childBusy || includeTerminalProfiles}
            onChange={event => setIncludeGitStatus(event.target.checked)} />{t("remoteMcp.owner.includeGitStatus")}</label>
          <label className="remote-mcp-git-opt-in"><input type="checkbox" checked={includeTerminalProfiles} disabled={busy || childBusy}
            onChange={event => { setIncludeTerminalProfiles(event.target.checked); if (event.target.checked) setIncludeGitStatus(true); }} />{t("remoteMcp.terminal.requestScope")}</label>
          <button className="secondary compact-button" type="button" disabled={busy || childBusy}
            onClick={() => void requestClient()}>{t("remoteMcp.owner.request")}</button>
        </> : null}
        {(snapshot.canApprove || snapshot.canRevoke) && snapshot.factors.length > 0 ? <>
          <label>{t("remoteMcp.owner.factor")}
            <select value={factorId} disabled={busy || childBusy} onChange={event => setFactorId(event.target.value)}>
              {snapshot.factors.map((factor, index) => <option key={factor.id} value={factor.id}>
                {factor.friendlyName || t("remoteMcp.owner.factorFallback", { number: index + 1 })}
              </option>)}
            </select>
          </label>
          <button className="primary compact-button" type="button" disabled={busy || childBusy || !factorId || (grantExpired && snapshot.canApprove)}
            onClick={() => void prepare(snapshot.canApprove ? "approve_client" : "revoke_client")}>
            {t(snapshot.canApprove ? "remoteMcp.owner.reviewApprove" : "remoteMcp.owner.reviewRevoke")}
          </button>
        </> : snapshot.clientGrant ? <p>{t(snapshot.approvalState === "totp_enrollment_required"
          ? "remoteMcp.owner.enrollTotp" : "remoteMcp.owner.reviewUnavailable")}</p> : null}
      </div> : <form className="remote-mcp-owner-review" onSubmit={event => { event.preventDefault(); void confirm(); }}>
        <strong>{t(review.action === "approve_client" ? "remoteMcp.owner.confirmApproveTitle" : "remoteMcp.owner.confirmRevokeTitle")}</strong>
        <p>{review.targetClient.name} · {t(review.allowedTools.includes("terminal.run_profile") ? "remoteMcp.owner.profileScope" : review.allowedTools.includes("git.status") ? "remoteMcp.owner.gitReadOnlyScope" : "remoteMcp.owner.readOnlyScope")}</p>
        <p>{t("remoteMcp.owner.reviewExpires", { seconds: Math.max(0, Math.ceil((review.expiresAt - now) / 1000)) })}</p>
        <label htmlFor="remote-mcp-owner-totp">{t("remoteMcp.owner.code")}</label>
        <input id="remote-mcp-owner-totp" type="password" inputMode="numeric" autoComplete="one-time-code"
          value={code} maxLength={6} pattern="[0-9]{6}" required disabled={busy}
          onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        <small>{t("remoteMcp.owner.codeHint")}</small>
        <div className="remote-mcp-owner-actions">
          <button className="primary compact-button" type="submit" disabled={busy || !/^\d{6}$/.test(code) || review.expiresAt <= now}>
            {t(review.action === "approve_client" ? "remoteMcp.owner.confirmApprove" : "remoteMcp.owner.confirmRevoke")}
          </button>
          <button className="ghost compact-button" type="button" disabled={busy} onClick={clearReview}>{t("remoteMcp.owner.cancel")}</button>
        </div>
      </form>}
    </> : null}
    {notice ? <p role="status">{t(("remoteMcp.owner.notice." + notice) as TKey)}</p> : null}
    {failure ? <p className="remote-mcp-owner-error" role="alert">{t(("remoteMcp.owner.error." + failure) as TKey)}</p> : null}
    <RemoteMcpMfaEnrollmentPanel needed={!snapshot || snapshot.factors.length === 0}
      canInteract={!busy && !review && !deviceReviewBusy} refreshEpoch={refreshEpoch}
      onBusy={setEnrollmentBusy} onComplete={() => void refresh()} />
    <RemoteMcpCurrentDevicePanel clientReady={clientReady} clientGrantId={snapshot?.clientGrant?.id ?? null}
      targetClientId={snapshot?.targetClient.id ?? null} factors={snapshot?.factors ?? []} allowedTools={snapshot?.allowedTools ?? []}
      canInteract={!busy && !review && !enrollmentBusy} refreshEpoch={refreshEpoch}
      onReady={setDeviceReady} onReviewBusy={setDeviceReviewBusy} onChanged={() => void refresh()} />
    <RemoteMcpRelayPanel canStart={clientReady && deviceReady && !busy && !review && !childBusy}
      refreshEpoch={refreshEpoch} allowGitStatus={clientReady && !!snapshot?.allowedTools.includes("git.status")}
      allowTerminalProfiles={clientReady && !!snapshot?.allowedTools.includes("terminal.run_profile")}
      factors={snapshot?.factors ?? []} onTerminalBusy={setTerminalReviewBusy}
      canReviewTerminal={!busy && !review && !deviceReviewBusy && !enrollmentBusy} />
  </section>;
}
