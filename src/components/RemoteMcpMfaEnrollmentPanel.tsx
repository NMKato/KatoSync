// Created by NMKato Solutions
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../i18n";
import { parseRemoteMcpMfaEnrollment, type RemoteMcpMfaEnrollment } from "../lib/remoteMcpMfaEnrollment";

export function RemoteMcpMfaEnrollmentPanel({ needed, canInteract, refreshEpoch, onBusy, onComplete }: {
  needed: boolean; canInteract: boolean; refreshEpoch: number; onBusy: (busy: boolean) => void; onComplete: () => void;
}) {
  const { t } = useT();
  const [enrollment, setEnrollment] = useState<RemoteMcpMfaEnrollment | null>(null);
  const [code, setCode] = useState(""); const [working, setWorking] = useState(false); const [failed, setFailed] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [now, setNow] = useState(Date.now());
  const operation = useRef(0); const pending = useRef(false); const alive = useRef(false);
  const handle = useRef<string | null>(null);
  const clear = () => {
    const id = handle.current; handle.current = null; setEnrollment(null); setCode("");
    if (id && window.__TAURI_INTERNALS__) void invoke("remote_mcp_mfa_enroll_cancel", { enrollmentId: id }).catch(() => {});
  };
  useEffect(() => {
    alive.current = true; operation.current++; pending.current = false; clear(); setWorking(false); setFailed(false); setConfigured(false); onBusy(false);
    return () => {
      alive.current = false; operation.current++; pending.current = false;
      const id = handle.current; handle.current = null;
      if (id && window.__TAURI_INTERNALS__) void invoke("remote_mcp_mfa_enroll_cancel", { enrollmentId: id }).catch(() => {});
      onBusy(false);
    };
    // An account-keyed parent and native auth generation invalidate prior setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, refreshEpoch, onBusy]);
  useEffect(() => { onBusy(working || enrollment !== null); }, [working, enrollment, onBusy]);
  useEffect(() => {
    if (!enrollment) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [enrollment]);
  useEffect(() => {
    if (enrollment && enrollment.expiresAt <= now) { clear(); setFailed(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollment, now]);
  const begin = async () => {
    if (!needed || !canInteract || pending.current || enrollment || !window.__TAURI_INTERNALS__) return;
    const epoch = ++operation.current; pending.current = true; setWorking(true); onBusy(true); setFailed(false); setConfigured(false); setCode("");
    try {
      const raw = await invoke("remote_mcp_mfa_enroll_begin");
      if (!alive.current || operation.current !== epoch) return;
      const checked = parseRemoteMcpMfaEnrollment(raw, Date.now());
      if (!checked) throw new Error("invalid_native_enrollment");
      handle.current = checked.enrollmentId; setNow(Date.now()); setEnrollment(checked);
    } catch (cause) {
      if (alive.current && operation.current === epoch) {
        clear();
        if (String(cause).includes("REMOTE_MCP_MFA_ALREADY_CONFIGURED")) { setConfigured(true); onComplete(); }
        else setFailed(true);
      }
    }
    finally { if (alive.current && operation.current === epoch) { pending.current = false; setWorking(false); } }
  };
  const confirm = async () => {
    if (pending.current || !enrollment || enrollment.expiresAt <= Date.now() || !/^\d{6}$/.test(code)) return;
    const epoch = ++operation.current; const id = enrollment.enrollmentId; const entered = code;
    setCode(""); setWorking(true); setFailed(false); pending.current = true;
    try {
      await invoke("remote_mcp_mfa_enroll_confirm", { enrollmentId: id, code: entered });
      if (alive.current && operation.current === epoch) {
        handle.current = null; setEnrollment(null); setConfigured(true); onComplete();
      }
    } catch { if (alive.current && operation.current === epoch) setFailed(true); }
    finally { setCode(""); if (alive.current && operation.current === epoch) { pending.current = false; setWorking(false); } }
  };
  if (!needed) return null;
  return <section className="remote-mcp-enrollment" aria-label={t("remoteMcp.enroll.title")}>
    <strong>{t("remoteMcp.enroll.title")}</strong>
    <p>{t("remoteMcp.enroll.scope")}</p>
    {!enrollment ? <button type="button" className="secondary compact-button" disabled={!canInteract || working || configured}
      onClick={() => void begin()}>{t(working ? "remoteMcp.enroll.working" : "remoteMcp.enroll.begin")}</button> :
      <form className="remote-mcp-owner-review" onSubmit={event => { event.preventDefault(); void confirm(); }}>
        <p>{t("remoteMcp.enroll.scan")}</p>
        <img className="remote-mcp-enrollment-qr" src={enrollment.qrCodeDataUrl} alt={t("remoteMcp.enroll.qrAlt")}
          width={240} height={240} draggable={false} referrerPolicy="no-referrer" />
        <p>{t("remoteMcp.owner.reviewExpires", { seconds: Math.max(0, Math.ceil((enrollment.expiresAt - now) / 1000)) })}</p>
        <label htmlFor="remote-mcp-enrollment-code">{t("remoteMcp.owner.code")}</label>
        <input id="remote-mcp-enrollment-code" type="password" inputMode="numeric" autoComplete="one-time-code"
          value={code} maxLength={6} pattern="[0-9]{6}" required disabled={working}
          onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        <small>{t("remoteMcp.owner.codeHint")}</small>
        <div className="remote-mcp-owner-actions">
          <button type="submit" className="primary compact-button" disabled={working || !/^\d{6}$/.test(code) || enrollment.expiresAt <= now}>{t("remoteMcp.enroll.confirm")}</button>
          <button type="button" className="ghost compact-button" disabled={working} onClick={clear}>{t("remoteMcp.owner.cancel")}</button>
        </div>
      </form>}
    {failed ? <p role="alert">{t("remoteMcp.enroll.failed")}</p> : null}
    {configured ? <p role="status">{t("remoteMcp.enroll.configured")}</p> : null}
  </section>;
}
