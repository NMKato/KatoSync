// Created by NMKato Solutions
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../i18n";
import { parseRemoteMcpTerminalApproval, parseRemoteMcpTerminalReview,
  type RemoteMcpTerminalApproval, type RemoteMcpTerminalReview } from "../lib/remoteMcpTerminalReview";
import type { RemoteMcpProjectOption } from "../lib/remoteMcpRelayState";
import type { RemoteMcpOwnerSnapshot } from "../lib/remoteMcpOwnerReview";

export function RemoteMcpTerminalPanel({ active, connectionActive, projects, factors, canInteract, onBusy }: {
  active: boolean; connectionActive: boolean; projects: RemoteMcpProjectOption[]; factors: RemoteMcpOwnerSnapshot["factors"];
  canInteract: boolean; onBusy: (busy: boolean) => void;
}) {
  const { t } = useT();
  const [projectId, setProjectId] = useState("");
  const [factorId, setFactorId] = useState("");
  const [review, setReview] = useState<RemoteMcpTerminalReview | null>(null);
  const [approval, setApproval] = useState<RemoteMcpTerminalApproval | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0); const alive = useRef(false); const pending = useRef(false);
  const reviewId = useRef<string | null>(null);
  const clearReview = () => {
    const id = reviewId.current; reviewId.current = null; setReview(null); setCode("");
    if (id && window.__TAURI_INTERNALS__) void invoke("remote_mcp_owner_cancel_review", { reviewId: id }).catch(() => {});
  };
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      alive.current = false; generation.current++; pending.current = false;
      const id = reviewId.current; reviewId.current = null;
      if (id && window.__TAURI_INTERNALS__) void invoke("remote_mcp_owner_cancel_review", { reviewId: id }).catch(() => {});
      clearInterval(timer); onBusy(false);
    };
  }, [onBusy]);
  useEffect(() => {
    if (!connectionActive) {
      generation.current++; pending.current = false; clearReview(); setApproval(null); setBusy(false); onBusy(false);
    }
    // Eine WSS-Erneuerung bleibt aktiv; Stop und Widerruf löschen die Anzeige.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionActive]);
  useEffect(() => { setProjectId(current => projects.some(p => p.id === current) ? current : projects[0]?.id ?? ""); }, [projects]);
  useEffect(() => { setFactorId(current => factors.some(f => f.id === current) ? current : factors[0]?.id ?? ""); }, [factors]);
  useEffect(() => { onBusy(busy || review !== null); }, [busy, review, onBusy]);
  useEffect(() => {
    if (review && review.expiresAt <= now) { clearReview(); setFailed(true); }
    if (approval && approval.expiresAt <= now) setApproval(null);
    // Der native Ablauf erzwingt dieselbe Frist unabhängig von der Anzeige.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, review, approval]);
  const prepare = async () => {
    if (!active || !canInteract || pending.current || review || !projects.some(p => p.id === projectId) || !factors.some(f => f.id === factorId)) return;
    const operation = ++generation.current; pending.current = true; setBusy(true); setFailed(false); setApproval(null); setCode("");
    try {
      const raw = await invoke("remote_mcp_terminal_prepare", { projectId, factorId });
      if (!alive.current || generation.current !== operation) return;
      const checked = parseRemoteMcpTerminalReview(raw, projectId, Date.now());
      if (!checked) throw new Error("invalid_terminal_review");
      reviewId.current = checked.reviewId; setReview(checked);
    } catch { if (alive.current && generation.current === operation) { clearReview(); setFailed(true); } }
    finally { if (alive.current && generation.current === operation) { pending.current = false; setBusy(false); } }
  };
  const confirm = async () => {
    if (!active || pending.current || !review || review.expiresAt <= Date.now() || !/^\d{6}$/.test(code)) return;
    const operation = ++generation.current; const currentReview = review; const entered = code;
    pending.current = true; setBusy(true); setFailed(false); setCode(""); setReview(null);
    try {
      const raw = await invoke("remote_mcp_terminal_confirm", { reviewId: currentReview.reviewId, code: entered });
      if (!alive.current || generation.current !== operation) return;
      const checked = parseRemoteMcpTerminalApproval(raw, currentReview, Date.now());
      if (!checked) throw new Error("invalid_terminal_approval");
      setApproval(checked);
    } catch {
      if (alive.current && generation.current === operation) { clearReview(); setFailed(true); }
    }
    finally {
      setCode("");
      if (alive.current && generation.current === operation) {
        reviewId.current = null; pending.current = false; setBusy(false);
      }
    }
  };
  return <section className="remote-mcp-terminal" aria-label={t("remoteMcp.terminal.title")}>
    <strong>{t("remoteMcp.terminal.title")}</strong>
    <p>{t("remoteMcp.terminal.scope")}</p>
    {!review ? <div className="remote-mcp-owner-actions">
      <label>{t("remoteMcp.terminal.project")}<select value={projectId} disabled={busy || !active} onChange={event => setProjectId(event.target.value)}>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      <label>{t("remoteMcp.owner.factor")}<select value={factorId} disabled={busy || !active} onChange={event => setFactorId(event.target.value)}>
        {factors.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendlyName || t("remoteMcp.owner.factorFallback", { number: index + 1 })}</option>)}
      </select></label>
      <button type="button" className="secondary compact-button" disabled={busy || !active || !canInteract || !projectId || !factorId}
        onClick={() => void prepare()}>{t("remoteMcp.terminal.prepare")}</button>
    </div> : <form className="remote-mcp-owner-review" onSubmit={event => { event.preventDefault(); void confirm(); }}>
      <strong>{t("remoteMcp.terminal.reviewTitle")}</strong>
      <p><code>{review.command}</code> · {review.projectId}</p>
      <p>{t("remoteMcp.terminal.once")}</p>
      <p>{t("remoteMcp.owner.reviewExpires", { seconds: Math.max(0, Math.ceil((review.expiresAt - now) / 1000)) })}</p>
      <label htmlFor="remote-mcp-terminal-code">{t("remoteMcp.owner.code")}</label>
      <input id="remote-mcp-terminal-code" type="password" inputMode="numeric" autoComplete="one-time-code"
        value={code} maxLength={6} pattern="[0-9]{6}" required disabled={busy || !active}
        onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
      <small>{t("remoteMcp.owner.codeHint")}</small>
      <div className="remote-mcp-owner-actions">
        <button type="submit" className="primary compact-button" disabled={busy || !active || !/^\d{6}$/.test(code) || review.expiresAt <= now}>{t("remoteMcp.terminal.confirm")}</button>
        <button type="button" className="ghost compact-button" disabled={busy} onClick={clearReview}>{t("remoteMcp.owner.cancel")}</button>
      </div>
    </form>}
    {approval ? <div role="status">
      <p>{t("remoteMcp.terminal.approved", { seconds: Math.max(0, Math.ceil((approval.expiresAt - now) / 1000)) })}</p>
      <p>{t("remoteMcp.terminal.shareOperation")}</p>
      <code style={{ userSelect: "all", overflowWrap: "anywhere" }}>{approval.operationId}</code>
      <p>{t("remoteMcp.terminal.project")}: {approval.projectId} · git --version</p>
    </div> : null}
    {!active ? <small>{t("remoteMcp.terminal.needsConnection")}</small> : null}
    {failed ? <p role="alert">{t("remoteMcp.terminal.failed")}</p> : null}
  </section>;
}
